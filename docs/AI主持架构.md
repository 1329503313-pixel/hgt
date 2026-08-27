# AI 主持架构

## 结论

AI 主持采用“模型做语义判定，服务端控制规则”的混合架构。控制面由规则判断器、游戏状态机、事实追踪器、节奏控制器和持久化任务编排组成；模型只返回严格结构化的五态答案与事实匹配证据，不能直接修改进度、投票或通关状态。DeepSeek 是主平台；主平台明确返回 HTTP 429 时，当前调用切换到火山方舟。

现有玩法保持不变：累计进度达到 80% 开启通关投票，达到 100% 自动通关，不新增玩家最终复述步骤。

## 单题处理链

```text
玩家正式提问
  -> 创建持久化 decision + 90 秒任务租约
  -> 简单问题：快速五态初判（只作临时展示）
  -> 完整结构化判定
  -> JSON Schema / Fact ID / 阈值校验
  -> 条件 Verifier
  -> 事实状态机 UNSEEN -> TOUCHED -> DISCOVERED
  -> 服务端按 DISCOVERED 权重计算进度
  -> 节奏规则发布补充汤面、里程碑、提示或投票
  -> 同一事务提交最终回答、事实、进度和回合状态
  -> WebSocket 广播
```

完整判定无法形成合法结果时，不生成兜底五态答案，不改变事实和进度，并清除临时回答。若完整判定合法、但纠错后的第二次 Verifier 仍拒绝，则进入确定性冲突裁决：快速回答与完整判定一致时保留该五态回答，不提交任何争议事实或进度；两者不一致时返回 `UNKNOWN` 且不推进事实。模型间分歧记录为 `verifier_status=rejected` 供管理审计，不再把玩家已经看到的临时回答替换成失败卡片。

## 控制器职责

| 组件 | 职责 | 禁止事项 |
|---|---|---|
| 结构化模型网关 | DeepSeek Chat JSON Object 主调用；遇到 HTTP 429 时切换方舟 Responses JSON Schema；执行超时、有限重试、并发限制和独立熔断 | 不生成业务兜底答案；非 429 不跨平台切换 |
| 规则判断器 | 校验五态枚举、Fact ID、置信度、匹配强度和发现强度 | 不相信模型返回的进度 |
| 事实追踪器 | 维护每回合版本化事实快照及三态；记录首次接触、发现用户和问题 | 已发现事实不重复计分 |
| 游戏状态机 | 控制 `PREPARING / PLAYING / READY_TO_SOLVE / SOLVING / COMPLETED / CANCELLED` | 模型不得直接迁移状态 |
| 节奏控制器 | 处理补充汤面、三级提示、20/40/60/80 里程碑、停滞提示和 80% 投票 | 不向玩家泄露未发现事实 |
| 任务编排 | question 幂等、上下文哈希、数据库租约、失败重试、事务提交 | 多实例不得重复结算 |

## 事实与进度

每道汤使用 5～15 个关键事实，权重总和固定为 100。回合开始时绑定不可变的事实版本快照，后续作者修改不影响进行中的回合。

- `UNSEEN`：未触及。
- `TOUCHED`：方向相关，但玩家尚未明确推出事实。
- `DISCOVERED`：玩家已明确表达事实，只有该状态计入进度。

`DISCOVERED` 的最低门槛是：匹配强度不低于 0.65、发现强度不低于 0.90、总置信度不低于 0.80，且没有无依据假设。进度始终由服务端汇总已发现事实权重。

## 模型协议与提示词

快速判定只返回 `answer` 和 `confidence`。完整判定返回：

- `answer`: `YES / NO / BOTH / UNKNOWN / IRRELEVANT`
- `confidence`
- `matchedFacts[]`: Fact ID、建议状态、匹配强度、发现强度
- `containsUnsupportedAssumption`
- `injectionDetected`

Prompt 将玩家问题标记为不可信数据，汤底和主持手册为唯一事实源；明确区分 `UNKNOWN` 与 `IRRELEVANT`，禁止补写常识设定、输出解释、汤底或进度。未知、重复或额外字段会让整次响应失效。Prompt Injection 最终由服务端显式越权模式判定，普通闲聊、数学题和其他无关问题只返回 `IRRELEVANT`，不得因模型误报进入注入校验失败。

以下情况触发二次验证：低置信度、`BOTH`、检测到无依据假设或提示词注入、发现核心/必需事实、单题跨越 80% 或 100%。Verifier 只允许 `ACCEPT` 或 `REJECT`；首次拒绝后完整判定重试一次，再次拒绝则整题失败并回滚临时结果。

供应商切换严格按上游 HTTP 状态判断：只有 DeepSeek 返回 429 才立即调用方舟，超时、网络错误、HTTP 5xx、空内容、JSON/Schema 校验失败或事实校验失败均不切换。两平台分别维护并发、重试和协议熔断状态，调用日志记录实际 `provider` 与 `model`。提示方向、事实生成、原子事实拆分和内容审核等 Chat 短任务遵循同一 429 切换规则。

## 一致性与重复问题

问题按标准化文本生成哈希。没有指代歧义的同题复用已完成判定；包含“他、它、刚才”等指代时，同时绑定最近有效问答和当前事实状态的上下文哈希，避免错误复用。每个问题只有一个 decision，worker 使用数据库租约防止多实例重复执行。

## 数据与审计

核心表：

- `ai_soup_fact_versions`、`ai_soup_facts`：版本化事实定义。
- `online_soup_round_fact_states`：回合事实三态和贡献归属。
- `online_soup_ai_decisions`：单题状态、哈希、租约、初判、终判和错误。
- `ai_call_logs`：模型原始请求、原始响应、耗时、token 和分类错误，30 天自动清理。
- `ai_decision_corrections`：人工纠错及是否应用到活动回合。
- `ai_regression_cases`、`ai_regression_runs`：固定问题期望值与执行结果。

模型认证头和 API Key 不进入审计数据。审计、纠错和回归接口只允许超级管理员访问。活动回合的人工事实纠错会重新计算进度；已结束回合仅追加审计，不回滚历史奖励。

## 主要代码

- `apps/server/src/aiHostProtocol.ts`：领域类型、Schema、事实阈值与纯规则。
- `apps/server/src/aiHostPrompts.ts`：快速判定、完整判定和 Verifier Prompt。
- `apps/server/src/aiProvider.ts`：DeepSeek/方舟双平台网关、429 故障转移、重试、并发、熔断与审计钩子。
- `apps/server/src/aiHostRepository.ts`：事实快照、decision 租约、事务持久化和日志清理。
- `apps/server/src/game.ts`：AI 用例编排。
- `apps/server/src/onlineSoup.ts`：多人房间接入、事务、广播、管理审计和回归接口。
