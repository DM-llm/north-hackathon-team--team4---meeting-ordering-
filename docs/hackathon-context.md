# 0731 Hackson 项目上下文

> 来源：飞书文档 https://sxddhcrtbqu.feishu.cn/wiki/E3Tpw8jcyi3HLCkidR8cipctnVh?from=from_copylink
>
> 本文件补充 North Hackathon 第 4 弹项目的实现上下文，供后续 Agent 快速理解会务系统范围、边界、运行方式和协作分工入口。
>
> **注意：原文档中包含明文环境变量示例。仓库中不得提交真实密钥；以下只保留变量名和用途，密钥由成员通过安全渠道单独配置。**

## 1. General Context

本次实现需要围绕 **Topic A：会务系统** 展开。

目标是为团队设计一个由 Agent 驱动、本地可运行的会议室查询与预订系统：

- 管理员通过自然语言配置会议室、开放时间和不可预约规则；
- 成员通过自然语言查询可用会议室、创建预约、取消预约；
- 配置结果必须真正进入系统状态，并参与后续冲突校验；
- 不能只做静态页面、固定表单或预设答案。

## 2. 会务系统空间规则

系统以实际使用空间为基础，以下空间关系和固定规则不得改变：

- **活动室**：中午作为餐厅，午餐时段不能预约会议；
- **会议室一、会议室二**：既可以分别使用，也可以合并成一间大会议室；
- **503、505、506**：三间小会议室，其中 **505 每周二全天不可用**。

团队可以补充容量、设备、位置等信息，但不得破坏以上规则。

## 3. 基础功能范围

### 3.1 自然语言配置 Agent

管理员可以用自然语言新增或修改：

- 会议室；
- 容量；
- 设备；
- 开放时段；
- 不可预约规则。

### 3.2 会议室列表

展示会议室名称、位置、容量、设备等基础信息。

### 3.3 日历或时段视图

查看会议室在指定日期或时段的占用情况。

### 3.4 创建预约 Agent

成员可以用自然语言预订，Agent 自动处理：

- 会议室；
- 日期；
- 开始时间；
- 结束时间；
- 会议信息。

### 3.5 冲突校验

同一会议室的重叠时段不得被重复预约；冲突时必须给出清晰提示。

### 3.6 取消预约

用户能够取消已有预约，并释放对应时段。

## 4. 挑战功能范围

优先从以下挑战功能中选择 1-2 个完成，以增强 Demo：

- **合并会议室**：两个或多个可组合空间在时间和容量上保持一致；
- **动态禁用**：支持维护、活动、午餐等临时不可预约时段；
- **管理员调整**：管理员能够修改、取消或强制调整已有预约；
- **地图/平面图视图**：在空间视图中查看会议室位置和状态。

## 5. 推荐验证场景

实现过程中优先跑通以下场景：

1. **下周二 10:00—11:00 想约一间小会议室开项目讨论，帮我看看有哪些可以用。**
   - 检查 Agent 正确理解输入；
   - 检查 502 不会出现在周二的可用结果中；
   - 检查 505 不会出现在周二的可用结果中。

2. **明天中午想预约活动室开会。**
   - 检查活动室的午餐用途会真实阻止中午的会议预约。

3. **本周五 14:00—16:00 要开一场大会议，帮我把会议室一和会议室二合并使用。**
   - 检查合并期间会议室一和会议室二不能再被分别预约。

4. **这周三 504 临时维修，全天不能预约。刚才说错了，只停用下午。**
   - 检查对 504 的连续修改只更新同一条规则；
   - 检查规则修改会实时反映到会议室和日历状态。

## 6. 实现边界

必须满足：

- 提供本地可运行的 Web 应用入口；
- 能够通过真实前端操作完成核心业务链路；
- 包含实际运行的 Agent 层：接收自然语言、形成结构化状态或约束，并调用业务能力完成配置、查询、预约或取消；
- 仅使用固定表单、关键词判断或预先写死答案，不能视为完成 Agent 要求；
- 前端不要求公网部署；
- README 必须提供清晰、可复现的安装和启动命令；
- 现场演示必须基于截止时冻结的 Git 版本启动。

允许使用：

- Vite、Next.js 等通用项目脚手架；
- 正常的开源框架、组件库和依赖；
- 团队在比赛期间自行编写的辅助脚本和测试。

不要求连接真实日历、支付、餐厅、会议室或其他外部生产系统。

## 7. Agent Runtime 与模型

比赛要求使用 North Studio / North Coder 的 RFC 开发 + N2 模型。

可选 Runtime：

- NexAU 本地运行；
- North Coder 本地 Runtime；
- NAC 云端 Runtime。

LLM API 必须使用 `nex-agi/Nex-N2-Pro` 或原文档中明确指定的 N2 系列模型。README 中需要说明所选 Runtime 和可复现的启动步骤。

## 8. 环境变量约定

原文档给出了运行 Agent 所需的环境变量形式。仓库中只记录变量名，不记录真实密钥：

```bash
OPENAI_BASE_URL=https://northgate.xiaobei.top/v1
OPENAI_API_KEY=<由成员通过安全渠道配置>
MODEL=nex-agi/Nex-N2-Pro-RS
```

后续实现如果新增 `.env.example`，应只包含变量名或占位值，例如：

```bash
OPENAI_BASE_URL=https://northgate.xiaobei.top/v1
OPENAI_API_KEY=
MODEL=nex-agi/Nex-N2-Pro-RS
```

不要将真实 `OPENAI_API_KEY` 提交到 Git。

## 9. 参考链接

- North Coder 使用文档：https://coder.xiaobei.top/docs
- RFC 开发：https://coder.xiaobei.top/docs/rfc-mode
- North Gate 使用文档：https://northgate.xiaobei.top/docs/product/enterprise/user-guide.html
- NAC 云端 Agent Runtime：https://nac.xiaobei.top/docs/tools/nac-cli
- NAC Agent Skill：https://nac.xiaobei.top/docs/tools/agent-skill
- NAC SDK：https://github.com/china-qijizhifeng/nac-sdk
- NAC/NexAU Cookbook：https://github.com/hzhua/nexau-cookbook/
- nexau artifact-builder skill：https://github.com/china-qijizhifeng/nexau-public-skills
- NexAU：https://github.com/china-qijizhifeng/nexau

## 10. 成员 RFC 分区

原文档预留了以下成员 RFC 分区，后续可在 `docs/rfcs/` 下补充对应 RFC 或任务分工：

- Jinxiu RFC
- Chenyu RFC
- Cunqi RFC

## 11. 与赛题存档的关系

- `docs/hackathon-spec.md` 是完整赛题说明存档。
- `docs/hackathon-context.md` 是本项目实现上下文补充，重点沉淀会务系统范围、验证场景、运行方式和参考链接。

后续 Agent 应优先阅读：

1. `AGENTS.md`
2. `docs/hackathon-spec.md`
3. `docs/hackathon-context.md`
4. `docs/rfcs/` 下已确认的 RFC
