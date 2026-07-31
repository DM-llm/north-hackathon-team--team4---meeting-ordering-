# 001 - Agent 会务系统 Demo 脚本

本脚本用于在 `feat/agent-meeting-system` 上现场演示 Topic A：Agent 驱动会议室查询与预订系统。脚本覆盖赛题基础场景，并突出合并会议室、动态禁用、规则版本递增等挑战功能。

> 前提：只使用 README 中记录的安装、初始化、启动、测试和构建命令；不要把真实 API Key 或真实数据库提交到 Git。

## 0. 准备环境

```bash
npm install
cp .env.example .env
npm run seed
npm run dev
```

启动后确认：

- 前端：http://localhost:5173
- API：http://localhost:3001/api
- 健康检查：http://localhost:3001/health

如果本地没有真实 NAC Key，`.env` 中的 `ALLOW_LOCAL_AGENT_FALLBACK=true` 会让 Agent 使用本地确定性解析兜底，仍可完成 Demo。

## 1. 查询下周二小会议室

### 目标

验证 Agent 能把自然语言查询转换为结构化查询条件，并基于真实规则排除不可用空间。

### 前端操作

1. 打开 http://localhost:5173。
2. 确认角色为 **Demo 成员**。
3. 在 Agent 对话输入框输入：

```text
下周二 10:00—11:00 想约一间小会议室开项目讨论，帮我看看有哪些可以用。
```

4. 点击发送。

### 预期结果

- 返回结构化意图：`query_availability`。
- 查询日期应为下周二，时间为 `10:00-11:00`。
- 可用结果应只包含小会议室类型。
- `505` 不应出现在可用结果中，因为 505 每周二全天不可用。
- 可看到 `503`、`506` 等可用小会议室。

### API 验证

```bash
curl -s 'http://localhost:3001/api/rooms/availability?date=2026-08-04&start_time=10:00&end_time=11:00&criteria=%E5%B0%8F%E4%BC%9A%E8%AE%AE%E5%AE%A4' | jq '.data.available[] | {id,name,type,available}'
```

> 日期示例基于当前日期 2026-07-31 推算。现场演示时，可使用前端返回的 `date` 替换 `date=2026-08-04`。

## 2. 活动室午餐冲突

### 目标

验证活动室午餐占用会真实阻止中午会议预约。

### 前端操作

1. 保持 **Demo 成员** 角色。
2. 输入：

```text
明天中午 12:00-13:00 想预约活动室开项目同步会。
```

3. 点击发送。

### 预期结果

- Agent 识别为创建预约意图。
- 后端业务规则引擎返回冲突。
- 冲突原因包含活动室午餐占用，例如 `活动室午餐时段作为餐厅使用 12:00-13:30`。
- 不会创建成功预约。

### API 验证

```bash
curl -s -X POST http://localhost:3001/api/agent/message \
  -H 'Content-Type: application/json' \
  -H 'x-user-role: member' \
  -d '{
    "message": "明天中午 12:00-13:00 想预约活动室开项目同步会。",
    "current_date": "2026-07-31",
    "role": "member"
  }' | jq '{ok, intent: .structured_intent.intent, reply, message}'
```

## 3. 合并会议室一/二

### 目标

验证 Agent 能处理大会议/合并会议室请求，并创建合并空间预约。

### 前端操作

1. 切换角色为 **Demo 管理员**。
2. 输入：

```text
本周五 14:00-16:00 要开一场大会议，帮我把会议室一和会议室二合并使用。
```

3. 点击发送。

### 预期结果

- Agent 识别为创建预约意图。
- 目标空间为 `combined-room1-room2`。
- 预约创建成功。
- 平面图或会议室状态中，合并空间在该时段显示为占用。

### API 验证

```bash
curl -s -X POST http://localhost:3001/api/agent/message \
  -H 'Content-Type: application/json' \
  -H 'x-user-role: admin' \
  -d '{
    "message": "本周五 14:00-16:00 要开一场大会议，帮我把会议室一和会议室二合并使用。",
    "current_date": "2026-07-31",
    "role": "admin"
  }' | jq '{ok, intent: .structured_intent.intent, reply, data: .data}'
```

## 4. 检查 room1/room2 被合并占用

### 目标

验证合并空间预约会反向阻塞两个基础房间，避免会议室一/二被拆分重复预约。

### 前端操作

1. 切换角色为 **Demo 成员**。
2. 输入：

```text
本周五 14:30-15:30 帮我预约会议室一。
```

3. 点击发送。

### 预期结果

- 创建预约失败。
- 返回合并空间占用冲突。
- 对 `会议室二` 做同样操作也应失败。

### API 验证

```bash
curl -s -X POST http://localhost:3001/api/agent/message \
  -H 'Content-Type: application/json' \
  -H 'x-user-role: member' \
  -d '{
    "message": "本周五 14:30-15:30 帮我预约会议室一。",
    "current_date": "2026-07-31",
    "role": "member"
  }' | jq '{ok, intent: .structured_intent.intent, reply, message}'

curl -s -X POST http://localhost:3001/api/agent/message \
  -H 'Content-Type: application/json' \
  -H 'x-user-role: member' \
  -d '{
    "message": "本周五 14:30-15:30 帮我预约会议室二。",
    "current_date": "2026-07-31",
    "role": "member"
  }' | jq '{ok, intent: .structured_intent.intent, reply, message}'
```

## 5. 504 临时维修全天禁用

### 目标

验证管理员自然语言配置不可预约规则，并且规则会写入 SQLite 参与后续状态。

### 前端操作

1. 切换角色为 **Demo 管理员**。
2. 输入：

```text
这周三 504 临时维修，全天不能预约。
```

3. 点击发送。

### 预期结果

- Agent 识别为新增不可预约规则。
- 目标空间为 `room504`。
- 规则创建成功。
- `GET /api/rules` 中 504 规则只有 1 条。
- 平面图或房间状态中，504 在该日期全天显示为禁用/维修。

### API 验证

```bash
curl -s -X POST http://localhost:3001/api/agent/message \
  -H 'Content-Type: application/json' \
  -H 'x-user-role: admin' \
  -d '{
    "message": "这周三 504 临时维修，全天不能预约。",
    "current_date": "2026-07-31",
    "role": "admin"
  }' | jq '{ok, intent: .structured_intent.intent, reply, data: .data}'

curl -s 'http://localhost:3001/api/rules/target/504/latest' | jq '.data | {id,target_room_id,start_at,end_at,version,reason}'
```

## 6. 修改为下午

### 目标

验证同一条临时维修规则可以被修改，而不是新增多条重复规则。

### 前端操作

1. 保持 **Demo 管理员** 角色。
2. 输入：

```text
刚才说错了，504 临时维修只停用下午 14:00-18:00。
```

3. 点击发送。

### 预期结果

- Agent 识别为修改规则。
- 后端找到最近一条 504 规则并更新同一记录。
- 规则时间变为 `14:00-18:00`。
- `GET /api/rules` 中 504 规则仍只有 1 条。
- 规则 `version` 从 1 递增到 2。

### API 验证

```bash
curl -s -X POST http://localhost:3001/api/agent/message \
  -H 'Content-Type: application/json' \
  -H 'x-user-role: admin' \
  -d '{
    "message": "刚才说错了，504 临时维修只停用下午 14:00-18:00。",
    "current_date": "2026-07-31",
    "role": "admin"
  }' | jq '{ok, intent: .structured_intent.intent, reply, data: .data}'

curl -s 'http://localhost:3001/api/rules/target/504/latest' | jq '.data | {id,target_room_id,start_at,end_at,version,reason}'
```

## 7. 验证同一条规则 version 递增

### 目标

明确展示规则版本和审计能力。

### 前端操作

1. 打开规则列表或审计日志区域。
2. 查看 504 规则详情。
3. 查看审计日志。

### 预期结果

- 504 规则记录数仍为 1。
- `version = 2`。
- 审计日志中存在：
  - `rule.create`
  - `rule.update`
- 规则修改不是删除后重建，而是同一条记录递增版本。

### API 验证

```bash
curl -s 'http://localhost:3001/api/rules' | jq '[.data[] | select(.target_room_id == "504")] | {count: length, latest: .[0] | {id, version, start_at, end_at, reason}}'

curl -s 'http://localhost:3001/api/audit-log' | jq '[.data[] | select(.entity_id | tostring | test("504|rule_"))] | .[0:10]'
```

## 8. 演示总结话术

可按以下顺序讲解：

1. **Agent 参与业务**：用户只输入自然语言，系统返回结构化意图和可执行操作。
2. **状态真实落库**：会议室、规则、预约写入 SQLite，不是前端静态展示。
3. **冲突校验真实生效**：活动室午餐、505 周二不可用、合并空间占用、临时维修均参与校验。
4. **挑战功能完整**：合并会议室、动态禁用、管理员调整、平面图均已覆盖。
5. **加分项清晰**：规则版本递增和审计日志证明规则修改可追踪。

## 9. 重置 Demo 数据

演示结束或需要重新演示时：

```bash
npm run seed
```

然后刷新前端即可回到初始状态。
