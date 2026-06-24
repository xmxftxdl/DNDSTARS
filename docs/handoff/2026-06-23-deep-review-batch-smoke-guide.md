# 交接报告 — DNDSTARS 深审批次(T-417..424)人工双端冒烟 step-by-step 指南

> 状态:8 个任务代码 + 自动化测试已全部完成并提交(commits `a7ecedf` / `b07061a` / `bde3427` /
> `9890804` / `209095b` / `6254da0` / `484bd3d` / `4afeb29`)。本文只覆盖**自动门覆盖不到、规格本身
> 指派给人工**的双端冒烟。跑完这些 = 整批 ground-truth 验证闭环。
>
> 这是活文档:跑一项就就地把对应「结果」格填 PASS/FAIL + 日期 + 现象,作为当前真相。

---

## 0. 通用准备(每次冒烟前都先做)

### 0.1 角色由端口决定(`src/lib/appMode.ts`)
| 角色 | dev 端口 | 生产 serve 端口 | URL(dev) |
|------|----------|------------------|-----------|
| DM   | 5173     | 5173             | http://127.0.0.1:5173 |
| 玩家1 | 5174     | 5174             | http://127.0.0.1:5174 |
| 玩家2 | 5175     | 5175             | http://127.0.0.1:5175 |

- DM 端有侧边栏 `/`(Dashboard)、`/maps`、`/characters`、`/combat`、`/ai`;
- 玩家端被强制只看 `/maps` 和 `/characters`(`App.tsx:53/58`),根路径自动跳 `/maps`。
- **DM 是战斗权威端**:HP/AP/qi/状态/伤害结算最终以 DM 为准;玩家端只做乐观本地反馈,被 DM 覆盖是**预期**,不是 bug(T-417 Option B)。
- **玩家端 `/characters` 只显示玩家自己被分配的那一张卡**(`playerView.ts:62` `playerViewCharacters` 返回 `[mine]`),不是全部角色。默认回退到 `sample-adventurer`(`PLAYER_VIEW_CHAR_ID`);指派可被 `stars-player-character-id:<slot>` 这个 **localStorage** 覆盖,而 localStorage **不随清共享根而清**,所以玩家端实际显示哪张卡取决于该窗口历史指派。HP/AP/qi 等战斗字段在 Option B 下玩家端**不可编辑**(DM 权威),别照搬「让玩家改 currentHp」这类步骤。

### 0.2 两种启动模式 —— 选哪种?
- **dev 模式(热重载,够用于 A/B/C/E)**:两个独立 vite-server 进程,各跑一端,共享同一文件根。
- **生产 serve 模式(D 必须用)**:`npm run build` 出 `dist/`,再起两个 static-server 进程。这是 T-421
  SSE 重连 bug 的**忠实复现环境**(原 bug 只在「两个独立 serve 进程各有一份内存 backlog」时出现)。

### 0.3 共享状态文件根(每次冒烟前**清空**以保证干净起点)
默认 `STARS_SHARED_ROOT` = `%LOCALAPPDATA%\StarsApp\shared`(内有 `state/` 与 `images/`)。

PowerShell 清空:
```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\StarsApp\shared" -ErrorAction SilentlyContinue
```
Git Bash 清空:
```bash
rm -rf "$LOCALAPPDATA/StarsApp/shared"
```
> 想隔离到临时目录:启动前 `:$env:STARS_SHARED_ROOT = "D:\tmp\stars-smoke"`(两端必须设成同一个)。

### 0.4 dev 模式启动(开两个终端,工作目录都在 `06_15_regulus_dice_proj/DNDSTARS`)
```bash
npm install        # 仅首次
# 终端 1 —— DM
npm run dev:dm        # http://127.0.0.1:5173
# 终端 2 —— 玩家1
npm run dev:player1   # http://127.0.0.1:5174
```
浏览器各开一个窗口(建议两个**独立窗口并排**,不是两个 tab,便于同时看)。

### 0.5 同步节奏与观察点
- `App.tsx:23` 每 **500ms** 调一次 `loadShared`(maps + characters)。所以「写一端 → 另一端可见」通常 < 1s;
  观察时**等 1–2 秒**再判定。
- 事件(SSE:trait-choice / dice / dodge / gale-combo)统一走 **canonical DM 端口**(T-421 修复)。
- 想看原始状态文件:`%LOCALAPPDATA%\StarsApp\shared\state\characters.json` / `maps.json` / `combat.json`
  —— 每个含 `updatedAt`(单调递增),排障时直接看它最直观。

---

## 1. Smoke A — 角色多端同步:DM 改名不被玩家旧快照冲掉(T-P1-417 / AC2)

**对应改动**:`mergePlayerWritableCharacter` 改为 Option B(玩家写盘对已知角色全量采用 DM shared);
publish 单调 stamp;loadShared 对称 `decideApply`。

> **2026-06-23 实跑修正(原步骤有三处错,已重写)**:
> 1. 原第 5 步「玩家改 currentHp」**语义错+做不到**:HP/AP/qi 是 DM 战斗权威字段,玩家端 UI 不可编辑。
> 2. 玩家端 `/characters` **只显示玩家被分配的那一张卡**(`playerView.ts:62`),默认 `sample-adventurer`;
>    要让玩家看到某角色,得先在玩家端右上角选择器把该角色**指派**给本 slot(写 localStorage)。
> 3. AC2 的「玩家旧快照不冲掉 DM」**方向手动摆不出来**——Option B 下玩家无越权写权限(`CharacterSheet:174`
>    改名框虽无 `isDM` 门控、玩家能输入,但 `saveCharacters:933-939` 写盘前 `mergePlayerWritableCharacter`
>    会把它回退成 shared,不落盘)。该方向已由 `syncMerge.test.ts` 的 AC3(:147)+ AC6(:162)**确定性锁定**,自动门绿。

**手动唯一能补的、单测补不到的**:单向传播 + 服务器 freshness guard 端到端接通。

**步骤(可跑版)**
1. 按 0.3 清共享根 → 0.4 起 dev 双端。
2. **玩家窗口(5174)** `/characters`:在右上角选择器把要测的角色(记作 **A**,例 `艾莉雅`)指派/选中为本 slot 的卡,确认页面显示 A 及其当前 name。
3. **DM 窗口(5173)** `/characters`:选中同一角色 A,把 name 改成新值(例 `艾莉雅·星语改`),失焦保存。
4. **盯玩家窗口**,等 1–2 秒(一轮 500ms loadShared)。

**PASS**:玩家窗口的 A.name 跟到 DM 的新值,且**稳定不回弹**。
**FAIL**:玩家端不变,或变了又跳回旧名字。
**排障/Ground truth**:`state/characters.json` 里 A.name = DM 那次写的值,`updatedAt` 单调递增。

---

## 2. Smoke B — 战中移动 token,敌人攻击打的是当前 HP 不是陈旧快照(T-P1-418 / AC2)

**对应改动**:`finishEnemyAttack` 不再读闭包捕获的 `activeMap`,改为在读取点 `useMapStore.getState()` 取 live token。
**前置**:需要一场进行中的战斗、至少一个敌人 token + 一个玩家/NPC 目标 token,且会触发 500ms dodge/save 轮询的敌人攻击。

**步骤**
1. 清共享根 → 起 dev 双端。
2. DM 窗口 `/maps`:布置一张地图,放至少 1 个敌人 token 和 1 个目标 token(玩家或 NPC),开始一场战斗,推进到**敌人回合**、敌人对目标发起攻击(进入闪避/豁免等待窗口)。
3. 在敌人攻击「已触发、结算未落定」的窗口内(dodge/save 轮询期),**改变目标的棋面状态**:移动该目标 token,或用别的方式改它的 HP。
4. 让敌人攻击结算完成。

**PASS**:敌人伤害作用在**目标当前**的 HP/位置上(结算后目标 HP = 当前值 − 伤害),战斗日志数字与当前棋面一致。
**FAIL**:伤害按移动/改血**之前**的快照结算(HP 对不上、或打到旧位置)。
**辅助**:`src/lib/combatStaleness.test.ts` 已用纯函数锁定 live-vs-stale 解析;此处只需肉眼确认 live 路径接的是 getState。

---

## 3. Smoke C — 切走/切回后,新的 combat 广播仍被应用(T-P1-418 / AC4)

**对应改动**:combat 去重/单调 watermark 从模块级全局改为组件内 `useRef`(remount 自动重置)。

**步骤**
1. 清共享根 → 起 dev 双端。
2. 玩家窗口(5174):在 `/maps` 开着、有一场进行中的战斗。
3. 玩家窗口:点侧边栏切到 `/characters`(让 MapsPage **卸载**),停留 2–3 秒,再切回 `/maps`(MapsPage **重新挂载**)。
4. DM 窗口:此时推进战斗产生一条**更新的** combat 广播(例如下一回合、一次伤害结算)。

**PASS**:切回后的玩家 `/maps` **应用了**这条新广播(回合/HP/状态跟上 DM)。
**FAIL**:切回后玩家停留在切走前的旧战斗态,新广播被「上一会话残留的水位」误判为陈旧而丢弃(本任务要修的 bug)。
**变体**(更强):切走→切回后,先确认收到一条新广播(PASS 的 then 分支);再让 DM **重发一条 id 相同/更旧**的,确认玩家**不**重复应用(dedup 的 else 分支仍在)。

---

## 4. Smoke D — 生产 serve 双进程:玩家重连后补发漏掉的事件(T-P1-421 / AC2)

**对应改动**:所有事件(SSE 订阅 + POST + DELETE)只走单一 canonical 端口(DM 5173),消除两个 serve 进程各自
backlog 的分歧。**必须用生产 serve 模式复现**(dev 是单 vite-server,看不出原 bug)。

**前置**:`npm run build`(出最新 `dist/`;serve 跑的是 dist 静态产物,旧 dist 会测到旧代码!)。

**步骤**
1. 清共享根。
2. `npm run build`(等 `dist/` 生成完)。
3. 起两个 serve 进程(任选其一):
   - 一键:`pwsh scripts/start-local-servers.ps1`(它会先杀 5173/5174,再各起一个 static-server 服务 `dist/`,
     末尾打印每端 OK 状态 + PID;注意脚本里 node 路径硬编码 `D:\study\Nodejs\node.exe`,找不到时回退 PATH 的 node);
   - 或手动两个终端:`npm run serve:dm`(5173) + `npm run serve:player1`(5174)。
4. 浏览器开 DM(5173)+ 玩家(5174)两窗口,进同一场景。
5. 在两端「在线」时,让 DM/玩家产生若干会走 SSE 的事件(发起一次掷骰请求 / 一次闪避 / 触发一个 trait-choice / gale-combo)。
6. **玩家窗口刷新(F5,模拟重连/迟到加入)**。

**PASS**:玩家刷新后,重放到的事件 backlog 与 DM 一致,之前**漏掉的**事件(trait-choice / dice / dodge / gale-combo)能补上,后续实时事件继续正常到达。
**FAIL**:玩家刷新后重放到空的/与 DM 不同的 backlog,漏事件不补(这正是 C2 原 bug)。
**辅助验证**:`src/lib/sharedApiEventTopology.test.ts` 已断言「即使配了 3 个端口,事件也只走第一个 canonical(DM)」。

---

## 5. Smoke E — 骰子叠层渲染(T-P2-424,去 badge 参后无功能回退)

**对应改动**:两个 overlay 的 iframe URL 去掉了从不被读的 `?badge=0`;死 CSS-3D 块已删(live `dice-box-*` 保留)。

**步骤**
1. 起 dev 任一端(`npm run dev:dm`),进 `/maps` 进入一场战斗。
2. 触发一次掷骰(攻击命中骰 / 伤害骰 / D20)。

**PASS**:骰子叠层正常弹出、动画播放、落定显示点数;**叠层显示的骰面 = 实际用于结算的骰值**(face-vs-value 一致)。
**FAIL**:叠层不渲染 / 报错 / 面与结算值不符。
**注意**:见第 7 节「已知残留」——`App.tsx:36` 预加载 iframe 仍带 `?badge=0`(无害,参数从不被读),不影响本冒烟。

---

## 6. 结果记录表(跑完就地填)

| 冒烟 | 对应 AC | 模式 | 结果 | 日期 | 现象/备注 |
|------|---------|------|------|------|-----------|
| A 角色多端同步 | T-417 AC2 | dev | ✅ PASS | 2026-06-23 | DM 改名 aria→「艾莉雅·星语改」,玩家1(已指派 aria)1-2s 跟上不回弹;characters.json updatedAt 单调。clobber 方向由 syncMerge.test 锁定 |
| B 战中移动取 live HP | T-418 AC2 | dev | 🟡 代码核验+单测背书(手动受阻) | 2026-06-24 | `finishEnemyAttack:5251` 用 `getLiveTokens=useMapStore.getState()` 在读取点取 live(`:5268`),非闭包 `activeMap`;`combatStaleness.test.ts` 确定性锁定 live-vs-stale。手动复现被环境摩擦阻断(见 §7.3) |
| C remount 后应用新广播 | T-418 AC4 | dev | ⬜ 未跑 | | combat watermark 已从模块级改组件内 `useRef`(`MapsPage:790` 一带);本次未手动复现 |
| D 生产重连补事件 | T-421 AC2 | **serve** | ⬜ 未跑 | | 需 build+serve 双进程;`sharedApiEventTopology.test.ts` 已断言单 canonical 端口;本次未手动复现 |
| E 骰子叠层渲染 | T-424 AC2/AC3 | dev | ⬜ 未跑 | | 本次未手动复现 |

全 PASS ⇒ 本批 ground-truth 闭环;有 FAIL ⇒ 记录现象,回对应任务 commit 排查。

---

## 7. 已知残留 / 待你定夺(本次**未动**,no-silent-gap 如实记录)

1. **`App.tsx:36` 预加载 iframe 仍带 `?badge=0`** —— T-424 的 spec 只列了两个 overlay
   (`DiceBoxD20Overlay.tsx` / `DiceBoxRollOverlay.tsx`),未列 `App.tsx`,故这第三处漏了。
   **无害**(`dice-box-frame.html` 只读 `sides`/`qty`,从不读 `badge`),纯一致性瑕疵。可在下次顺手删。
2. **T-420 超范围 flag:MapsPage `resolveAttack` 的直接赋值 status 点**
   (`:3253/:3254` burn/poison、`:3285/:3365/:3489` stun、`:3295/:3308` restrained、`:3371` vulnerable)用 `set`
   而非 `Math.max`。若技能把较短状态盖到较长的会 overwrite-down。**不在** plan-review 列举的 3 处叠加副本内
   (AC3 明确只指 `combatAuthority:157`),按锁定 scope 未动,也未落 task_db —— 是否单开 follow-up 由你决定。

3. **【2026-06-24 实跑挖出·与本批次无关·建议单开 follow-up】`dnd.ts:abilityMod` 修正表 vs SAMPLE 种子属性的标度错配 → 全员 maxHp 被钳成 1。**
   `abilityMod`(`src/lib/dnd.ts:47`)用 1–100 制、基准 25 的桶(`ABILITY_BASELINE=25`,`MAX_ABILITY_SCORE=100`;≥25 才 mod≥0,且桶非单调:≤9→-2、≤14→-3、≤19→-2)。而 `store/characters.ts:SAMPLE` 种子角色用 D&D 3–18 制属性(con 12–16),全部远低于基准 → **负 modifier** → `computeMaxHp = max(1, 6 + level×mod + equip.hpBonus)`(`combatStats.ts`)被 `max(1,…)` 钳成 **1**。
   - 因果实证:新冒险者 con=25(=基准)→ mod 0 → maxHp 6(对上观测到的 4/6);其余 con<25 全 → maxHp 1。
   - 派生链:`loadShared` → `finalizeCharacter` → `syncCombatDerivedStats`(`combatStats.ts:342`)用 `getMaxHp` **重算并覆盖**存储的 maxHp,再 `currentHp=min(currentHp,maxHp)`。**故直接改 state 文件里的 maxHp 永远无效**,要改 con/level/装备 hpBonus 这些输入。
   - `git log` 显示该桶自「Initial project commit」就存在 → **不是 T-417..424 引入**,但让种子角色在战斗里基本不可用(1 血),且同一 `abilityMod` 还喂 AC/攻击/豁免/技能,影响面广。修与不修(改 `abilityMod` 公式 vs 把 SAMPLE 属性提到游戏标度)是个语义决策,留给 owner。

4. **Smoke B 手动复现本次未闭环(环境摩擦,非 T-418 修复问题)。** 阻塞点串成:① 种子角色 1 血(见上),已临时把全员 con 提到 60 给出真实血头(铁拳 41/莉娅 31);② 敌人攻击的闪避选择弹在**玩家窗口**,DM 端只显示"敌人行动中…",15s pending 窗口若玩家窗口不在前台/未答复即超时自动"未尝试闪避"结算;③ 重开战斗时点击未生效(`startCombat:5041` 有 `window.confirm` 阻塞式弹窗,疑似环境相关,未定论)。B 的修复本体已按"代码核验+单测背书"记 PASS-equivalent;真要端到端手动复现,建议下次用单一窗口排布、且在 pending 窗口内**拖动目标 token / 改 HP(战中 HP 编辑无锁,`CharacterDetailPanel` 仅 isDM 门控)**后再让其结算。

---

## 8. 回滚 / 重置速查
- 清状态重来:见 0.3。
- 杀残留 serve 进程:`pwsh scripts/start-local-servers.ps1` 自带先杀 5173/5174;或 PowerShell
  `Get-NetTCPConnection -LocalPort 5173,5174 | %{ Stop-Process -Id $_.OwningProcess -Force }`。
- serve 测到旧行为?→ 八成是 **dist 没重建**:重跑 `npm run build`。
- 自动门随时复跑(无需任何外部依赖):`npx tsc -b && npx vitest run && npm run lint:ratchet`。
