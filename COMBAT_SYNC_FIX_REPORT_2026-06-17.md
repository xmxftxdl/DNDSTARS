# 战斗同步修复报告 - 2026-06-17

## 本轮提交

- `2aff1d5`：新增战斗同步修复工作流与基线 bug report。
- `33c8bf0`：新增 DM 权威战斗结算核心与单元测试。
- `91d9444`：`combat` 快照改为 DM 端发布，玩家端不再执行回合开始/死亡跳过副作用。
- `319cf27`：玩家结束回合改为 `player-action` 请求，DM 验证后推进回合并 ACK。
- `1bbcb48`：共享闪避改为 DM 端结算，加入 15 秒超时兜底。
- `b063595`：敌人第二行动支持移动并扣 AP。
- `d76868c`：战斗中阻止玩家端写共享 `characters` / `maps`，避免覆盖 DM 血量/AP/token。
- `481d155`：删除共享闪避里不可达的玩家端扣 AP 旧路径。
- `fbcd845`：停止发布旧 `dice-stream`，只保留带结果值的 `dice-roll-request` 路径。

## 已修复

1. DM 端成为 `combat` 快照唯一写入者。
2. 玩家端结束回合不再本地推进先攻，改为请求 DM。
3. 玩家端共享闪避不再本地扣 AP，只回传选择与 D20。
4. DM 端收到闪避答案后统一扣 AP、判定、伤害结算。
5. 闪避请求 15 秒未响应会自动按“不闪避”继续结算。
6. 怪物第二行动可移动，并会消耗 AP。
7. 战斗中玩家端不能把本地 `characters/maps` 写回共享状态。
8. 骰子旧 stream 发布已停，减少重复骰子/两端不一致来源。

## 新增测试

新增 `src/lib/combatAuthority.test.ts`，覆盖：

- 开始战斗初始化玩家和敌人 AP。
- 玩家端不能初始化权威 AP。
- 激活特性扣 1 AP。
- 移动扣 1 AP。
- 攻击扣 1 AP。
- 怪物攻击扣 AP。
- 闪避成功：扣闪避 AP，不造成伤害。
- 闪避失败：扣闪避 AP，造成伤害。
- 玩家端闪避请求不能改变权威 HP/AP。

## 验证

- `npm test`：通过，3 个测试文件，29 个测试。
- `npm run build`：通过。
- `git status --short`：干净。

## 剩余风险

### P1：玩家移动/攻击/主动特性仍未完全请求化

静态扫描显示 `src/pages/MapsPage.tsx` 仍有大量旧入口直接调用：

- `spendAP(...)`
- `updateChar(...)`
- `updateToken(...)`
- `damageChar(...)`
- `useSkillStore(...)`
- `useClassFeature(...)`

本轮通过 `sharedApi` 阻止玩家端在战斗中把 `characters/maps` 写回共享状态，因此它们不会再覆盖 DM 权威结果。但这些入口仍会短暂改变玩家本地 store，之后再被 DM 同步覆盖。下一步应把移动、攻击、激活特性也迁移到 `player-action` 请求通道。

### P2：旧 dice-stream 监听仍存在

本轮已停止发布旧 `dice-stream`，但旧监听和类型仍保留。它现在不会接到新事件，但后续可以删除：

- `SharedDiceStreamEvent`
- `SharedDiceStreamPayload`
- `pendingDiceStreamsRef`
- `subscribeSharedEvent('dice-stream-...')`

### P2：共享状态仍缺少全局单调版本号

`player-action` 已有请求 id，`combat` 快照仍主要依赖 `updatedAt` 和本地 guard。后续建议给 `SharedCombatState` 加 `seq`，客户端丢弃旧 seq。

## 下一步建议

1. 把玩家移动接入 `player-action`，DM 扣 AP、移动 token、广播。
2. 把玩家基础攻击/技能攻击接入 `player-action`，玩家端只负责目标选择和骰子结果提交，DM 计算伤害。
3. 把主动特性激活接入 `player-action`，DM 统一扣 AP/次数。
4. 删除旧 dice-stream 监听代码。
5. 给 `combat`、`characters`、`maps` 战斗字段加单调版本号。
