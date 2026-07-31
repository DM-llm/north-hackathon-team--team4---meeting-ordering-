# Project RFCs

本目录包含项目的 RFC（Request for Comments）文档。

## RFC 是什么

RFC 是一种用于记录技术设计决策的文档格式。每个 RFC 描述一个特定的功能、架构变更或技术决策，包括：

- **问题背景**：为什么需要这个变更
- **设计方案**：如何解决问题
- **权衡取舍**：考虑过的替代方案
- **实现状态**：当前进度

## RFC 状态

| 状态 | 说明 |
|------|------|
| `draft` | 草稿，正在讨论 |
| `accepted` | 已接受，待实现 |
| `implementing` | 实现中 |
| `implemented` | 已实现 |
| `superseded` | 被更新的 RFC 取代 |
| `rejected` | 已拒绝 |

## RFC 列表

### 会务系统

| RFC | 标题 | 状态 | 优先级 |
|-----|------|------|--------|
| [RFC-0001](./0001-agent-meeting-system.md) | Agent 驱动会务系统 | draft | P0 |

## RFC 编号规则

- 使用 4 位数字编号，如 `0001`
- 编号顺序分配，不跳号
- 被 superseded 的 RFC 保留原编号
- 相关功能的 RFC 使用连续编号
