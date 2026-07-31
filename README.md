# North Hackathon Team 4 - Agent 会务系统

Team：**Team 4**  
Topic：**Topic A - 会务系统**  
实现分支：`feat/agent-meeting-system`

本项目是一个由 Agent 驱动的本地可运行会议室查询与预订系统。管理员可以通过自然语言配置会议室、开放时间和不可预约规则；成员可以通过自然语言查询可用空间、创建预约、取消预约；系统会把配置、规则和预约写入真实业务状态，并在后续查询与预约时进行确定性冲突校验。

## 技术架构

本实现选择：

- **Agent Runtime**：NAC 云端 Agent Runtime。
- **模型调用入口**：North Gate OpenAI-compatible endpoint。
- **模型**：`nex-agi/Nex-N2-Pro-RS`。
- **持久化**：SQLite，使用 `better-sqlite3` 访问本地数据库。
- **前端**：Vite + React。
- **后端 API**：Express。
- **整体架构**：Vite/React + Express/better-sqlite3。

核心数据流：

1. 用户在前端输入自然语言。
2. 前端调用本地 API：`http://localhost:3001/api/agent/message`。
3. 本地 API 将请求转发给 NAC 云端 Agent Runtime / North Gate OpenAI-compatible endpoint，使用 `nex-agi/Nex-N2-Pro-RS` 生成结构化意图。
4. 本地业务规则引擎校验时间、空间、权限、合并关系和不可预约规则。
5. 校验通过后才写入 SQLite，并返回可解释结果。
6. 前端刷新会议室列表、日历/时段视图、平面图和对话结果。

> 如果没有配置真实 API Key，系统会使用本地确定性解析兜底，便于现场 Demo 稳定运行；配置 Key 后会通过 NAC 云端 Agent Runtime 调用模型。

## 核心要求满足情况

| 赛题要求 | 当前实现 |
| --- | --- |
| 管理员自然语言配置会议室、开放时间和不可预约规则 | 支持通过 Agent 消息创建/修改规则；会议室和规则会写入 SQLite。 |
| 会议室列表 | `GET /api/rooms` 返回活动室、会议室一/二、503/505/506、合并空间及当前状态。 |
| 日历或时段视图 | `GET /api/rooms/availability` 和平面图接口可展示指定日期/时段的可用、占用、禁用状态。 |
| 成员自然语言创建预约 | `POST /api/agent/message` 可解析预约意图并调用业务层创建预约。 |
| 冲突校验 | 预约、午餐占用、505 周二不可用、临时维修、合并占用均通过统一区间约束模型校验。 |
| 取消预约 | 支持成员取消自己的预约，管理员可取消任意预约。 |
| 配置真正进入状态 | 规则、预约、审计日志均持久化到 SQLite，刷新和重启后仍保留。 |

## 固定空间规则

- **活动室**：中午作为餐厅，午餐时段不可预约会议。
- **会议室一、会议室二**：可分别使用，也可合并为 `combined-room1-room2`。
- **503、505、506**：三间小会议室。
- **505**：每周二全天不可用。
- **504**：Demo 中用于演示临时维修规则的动态新增、修改和版本递增。

## 挑战功能与加分项

### 已覆盖的挑战功能

- **合并会议室**：会议室一和会议室二可合并成大会议室；合并占用期间，两个基础房间不能再被分别预约。
- **动态禁用**：支持临时维修、午餐占用、周期不可用等不可预约规则。
- **管理员调整**：管理员可以修改、取消或强制调整预约，并写入审计日志。
- **地图/平面图视图**：前端提供平面图，展示房间状态、占用和禁用信息。

### 加分项

- **规则版本与审计**：连续修改同一条规则时只更新同一记录，`version` 递增，并记录审计日志。
- **统一区间约束模型**：预约、午餐、固定禁用、临时禁用、合并占用统一参与冲突校验。
- **可复现 Demo 数据**：`npm run seed` 会初始化默认房间、固定规则和演示用户。
- **本地确定性兜底**：缺少真实 Key 时仍可完成基础 Demo，避免现场环境不稳定。
- **结构化 Agent 输出**：Agent 输出结构化意图，本地业务层负责最终校验和执行。

## 环境变量说明

根目录提供 `.env.example`，请复制为 `.env` 后使用。**不要提交真实 API Key、NAC 凭证或生产数据库文件。**

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `OPENAI_BASE_URL` | `https://northgate.xiaobei.top/v1` | North Gate OpenAI-compatible API base URL。 |
| `OPENAI_API_KEY` | `sk-your-nac-api-key-here` | NAC API Key 或兼容 OpenAI API Key。请勿提交真实值。 |
| `NAC_API_KEY` | `sk-your-nac-api-key-here` | `OPENAI_API_KEY` 的别名，二选一配置即可。请勿提交真实值。 |
| `OPENAI_MODEL` | `nex-agi/Nex-N2-Pro-RS` | 默认模型。 |
| `PORT` | `3001` | 本地 Express API 端口。 |
| `DATABASE_URL` | `file:./data/meeting-ordering.sqlite3` | SQLite 数据库文件路径。 |
| `ALLOW_LOCAL_AGENT_FALLBACK` | `true` | 缺少 Key 或 NAC 请求失败时使用本地确定性解析兜底。 |

## 本地启动

```bash
# 1. 安装依赖
npm install

# 2. 复制环境变量示例；不要提交真实 key
cp .env.example .env

# 3. 初始化 Demo 数据
npm run seed

# 4. 同时启动 API 和前端
npm run dev
```

启动后访问：

- 前端：http://localhost:5173
- API：http://localhost:3001/api
- 健康检查：http://localhost:3001/health

## 测试与构建

```bash
# 运行测试
npm run test

# 构建 API 和前端
npm run build
```

## Demo 流程

完整可演示脚本见：[`docs/demo/001-agent-meeting-system.md`](docs/demo/001-agent-meeting-system.md)

建议演示顺序：

1. 重置 Demo 数据：`npm run seed`。
2. 启动服务：`npm run dev`。
3. 在前端切换到 **Demo 成员**，查询下周二小会议室。
4. 尝试明天中午预约活动室，验证午餐规则冲突。
5. 切换到 **Demo 管理员**，创建会议室一/二合并大会议预约。
6. 检查 room1/room2 在合并占用时段被阻止。
7. 新增 504 全天临时维修规则。
8. 修改同一条规则为下午 14:00-18:00。
9. 验证规则仍是一条记录，但 `version` 从 1 递增到 2。

## 常用 API

| 接口 | 说明 |
| --- | --- |
| `GET /api/rooms` | 查看会议室、合并空间和当前状态。 |
| `GET /api/rooms/availability?date=&start_time=&end_time=&criteria=` | 查询指定日期和时段可用空间。 |
| `GET /api/rooms/floor-plan?date=&time=` | 获取平面图状态。 |
| `POST /api/agent/message` | 发送自然语言请求，返回结构化意图和业务结果。 |
| `GET /api/rules` | 查看不可预约规则列表。 |
| `GET /api/rules/target/:roomId/latest` | 查看某个空间最近一条规则。 |
| `POST /api/reservations` | 创建预约。 |
| `DELETE /api/reservations/:reservationId` | 取消预约。 |
| `GET /api/audit-log` | 查看管理员配置、规则修改、预约调整等审计日志。 |

## 提交冻结命令

最终提交前请基于冻结版本验证并推送 `submission` tag：

```bash
git status
git add .
git commit -m "chore: finalize hackathon submission"
git push origin main
git tag submission
git push origin submission
```

如果当前默认分支名不是 `main`，请将 `git push origin main` 替换为实际分支名。
