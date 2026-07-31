# 项目协作规则（AGENTS.md）

本文件用于指导后续 Agent 在本仓库中协作开发 North Hackathon 第 4 弹项目。后续 Agent 应优先阅读并遵守以下规则。

## 1. 项目简介

本项目是 North Hackathon 第 4 弹参赛作品，团队 4 选择的 Topic 是 **会务系统**。

目标是实现一个由 Agent 驱动、本地可运行的会议室查询与预订系统：管理员可通过自然语言配置会议室、开放时间和不可预约规则；成员可通过自然语言查询可用会议室、创建预约、取消预约；系统必须将配置与预约写入真实业务状态，并基于状态完成冲突校验。

核心空间规则包括：

- **活动室**：中午作为餐厅，午餐时段不能预约会议；
- **会议室一、会议室二**：既可以分别使用，也可以合并成一间大会议室；
- **503、505、506**：三间小会议室，其中 **505 每周二全天不可用**。

完整赛题说明已存档在：

- `docs/hackathon-spec.md`

后续 Agent 在开始设计或编码前，应先读取该文件，确认比赛要求、Topic 范围、硬性约束、提交规范和评分标准。

## 2. 开发模式

本项目采用 **RFC-driven development**：

1. 先阅读 `docs/hackathon-spec.md` 和现有 README；
2. 明确当前会务系统范围、关键设计决策和任务拆分；
3. 在 `docs/rfcs/` 下创建或更新 RFC；
4. RFC 被确认后再实现代码；
5. 实现过程中如出现重大设计变化，应回到 RFC 更新设计或记录决策。

不要在未理解赛题和当前仓库状态的情况下直接大规模改代码。

## 3. Agent 工作原则

- 优先保证最终 Demo 可运行，而不是堆砌功能。
- 优先完成会务系统基础功能闭环，再选择 1-2 个挑战功能增强 Demo。
- Agent 必须真正参与业务流程：接收自然语言，转换为结构化状态/约束，并调用业务能力完成查询、预约、取消或规则调整。
- 不要只写静态页面、固定表单或硬编码答案。
- 所有关键假设、范围边界、接口契约、数据模型和任务拆分，应优先写入 RFC 或 README。
- 如果用户只说“先做”“先提交”等简短指令，应先检查当前文件状态，再执行最小必要动作，并在完成后汇报 commit / push 结果。

## 4. 文件约定

### 4.1 必须保留

- `README.md`：项目总览、启动方式、Demo 数据、成员贡献、已知限制。
- `docs/hackathon-spec.md`：赛题说明存档。
- `docs/rfcs/`：RFC 工件目录。
- 应用源码目录：后续根据技术栈创建，例如 `apps/web`、`src` 或其他结构。
- 依赖清单与 lockfile：例如 `package.json`、`package-lock.json`、`pnpm-lock.yaml` 等。

### 4.2 提交规范

提交信息使用清晰前缀：

- `docs: 添加/更新文档`
- `rfc: 创建/更新 RFC`
- `feat: 实现某功能`
- `fix: 修复问题`
- `test: 添加测试`
- `chore: finalize hackathon submission`

最终截止前必须冻结 `submission` tag：

```bash
git status
git add .
git commit -m "chore: finalize hackathon submission"
git push origin main
git tag submission
git push origin submission
```

如没有待提交内容，可跳过 `git add` 和 `git commit`，但必须确认当前版本并打 tag。

## 5. 技术栈建议

如用户未指定技术栈，后续 Agent 可建议轻量方案：

- 前端：Vite + React + TypeScript，或 Next.js；
- 状态/业务层：本地 TypeScript 业务服务 + 持久化 JSON/SQLite；
- Agent Runtime：优先按比赛要求使用 North Coder / NexAU / NAC；
- LLM：必须使用 `nex-agi/Nex-N2-Pro`；
- UI：可直接使用基础 CSS、Tailwind、shadcn/ui 或其他开源组件库。

不要在未确认的情况下引入过多重型依赖。

## 6. Demo 优先策略

Demo 应能从 `submission` 对应版本启动，并通过真实前端操作完成核心链路。

### 会务系统 Demo 最低闭环

- 管理员通过自然语言配置会议室/规则；
- 查看会议室列表或日历视图；
- 成员通过自然语言创建预约；
- Agent 进行冲突校验；
- 用户取消预约；
- 至少覆盖一个挑战功能，例如动态禁用或合并会议室。

建议优先验证以下场景：

- 下周二 10:00—11:00 查询可用小会议室；
- 明天中午预约活动室开会，应被午餐规则阻止；
- 本周五 14:00—16:00 合并会议室一和会议室二；
- 临时维修规则可新增、修改，并实时反映到会议室和日历状态。

## 7. 质量要求

- 每次改动后运行可用测试或至少完成启动验证。
- 保持 README 与当前实现同步。
- 保持本地 `git status` clean，除非用户明确要求保留未提交改动。
- 对重要变更给出简洁说明：改了哪些文件、为什么改、如何验证。
- 不破坏已有 `docs/hackathon-spec.md` 和 RFC 工件。

## 8. 参考文档

- 赛题说明：`docs/hackathon-spec.md`
- North Coder 文档：https://coder.xiaobei.top/docs
- RFC 开发：https://coder.xiaobei.top/docs/rfc-mode
- NAC 文档：https://nac.xiaobei.top/docs/tools/nac-cli
