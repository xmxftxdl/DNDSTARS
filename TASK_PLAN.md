# DNDSTARS — Override-Upstream-Gaps Task Plan

Branch: `override-upstream-gaps` (off `origin/main` @ `3b17221`). Repo: nested git repo at `DNDSTARS/`.

## Execution progress (serial, main session)
- ✅ **T2** `03955c1` — timer lifecycle + reentrancy (A6/A7/A8/A9/A10/A11/A12)
- ✅ **T1** `8cb9ade` — NPC/obstacle deadlock auto-skip (A1/A2/BUG③)
- ✅ **T3** `ff394a0` — DOT damage + stun-skip (C1/C2)
- ✅ **T4** `fee64ad` — vulnerable + restrained + enemy condition display (C3/C4/C5/C8); restrained-advantage deferred
- ✅ **T5** `fe55fc6` — status label single-source + registry + condition reconcile + emoji (C6/C7/C9/C10); C11 deferred
- ✅ **T6** `6070b3c` — structured attack schema + derived stats for all 25 + unified HP source (B1/B2/B9/B10); AC0: pool↔block is a bijection of 25 (stale "superset/24" premise corrected). 44→57 tests
- ✅ **T7** `6744484` — enemy AI uses real structured attacks + npc targeting + data-driven breath + DEFAULT_ENEMY_AC unified (3 sites) + stale-poolId warn-once + text hygiene (B3–B8/B11/B12); B7 dead `targetTokenPatch` branch+field removed. 57→64 tests
- ✅ **T8** `a8a64bc` — selection clears on delete/death/map-switch + occupancy drop-guard + 4px drag threshold + fittedRef-reset (no remount) + hover-race fix + tracked tween cancel + keyboard move/delete (D1–D7,D10); AC4 prevented-by-construction; D13 dropped. 64→68 tests
- ✅ **T9** `be725c5` — deleted dead rageShot block (if(false) was nested in it, one deletion) + blob-URL single owner (manual path, dropped useImage) + status-anim 30fps throttle & mount-gating (8 effects) + mojibake comments fixed + MapCanvas BOM stripped (D8–D12). 68 tests
- ✅ **T10** `75aead0` — canonical characterHpTokenPatch HP mirror (no parallel reconciler) + character deletion tombstones (sync save, 10s GC) + maps store version 1 + migrate + enemyAp torn-read hardening (E4/E11/E10/E13). 68→81 tests
- ✅ **T11** — shared-server-core.mjs (lockfile wx+10s-stale, OPT-IN STARS_SHARED_SECRET default-off byte-equiv + player allowlist preserved, 8MiB/24MiB caps + 100-replay, image quota 64 + player orphan GC, collision-safe safeName + static-server 404, decideApply monotonic guard player-side) (E1/E6/E7/E8/E9/E14). 81→115 tests
- ⬜ **T12** (next) → T13 → T14 → T15
- Each task: `npx tsc -b` + `npm test` (44 baseline) green before commit. Resume from the next ⬜ task; all context is in this file.

## Plan-review status
Self-reviewed 2026-06-19 by a fresh-context refute-by-default reviewer (27 findings, all adjudicated & folded in): T2↔T1 reordered; T3 DOT double-apply hard-guarded; T13 export/extraction circularity closed; 3 non-bugs dropped (T10 enemyAp already-persisted, T12 F4 fallback-misread, T12 F5 percentile documented-as-designed); T11 auth made opt-in/allowlist-aware; ungrounded line/integration citations corrected; A3/A5/E2/E3/E5/E12 confirmed upstream-fixed (out of scope). Execution order: **T2→T1→T3→T4→T5→T6→T7→T8→T9→T10→T11→T12→T13→T14→T15**.

## Global Context

Upstream (`origin/main`, xmxftxdl) landed 34 "combat sync" commits that fixed the **multi-writer / DM-authority** axis (audit E + A3 dodge) but left ~40 audit items NOT_FIXED or PARTIAL. This plan overrides every remaining gap. Source of truth for the gaps is the 2026-06-19 completeness report (cross-check of the 2026-06-16 audit against current code).

### Hard constraints (apply to ALL tasks)
- **Dead framework stays.** `src/lib/combatAuthority.ts`, `src/lib/combatResolutionPipeline.ts`, `src/lib/combatReactionHooks.ts` (+ their tests) are NOT wired into `MapsPage.tsx`. Do **not** import them into the live engine and do **not** delete them. All fixes go into the **live** engine (the hand-rolled timer/effect code in `MapsPage.tsx` + the `src/lib`/`src/store` modules it uses).
- **No regression to the green baseline.** Every task ends with `npm run build` (tsc -b && vite build) green AND `npm test` green (44 tests at baseline; tasks may ADD tests, never break existing).
- **Authority model is settled.** Combat state is DM-authored and broadcast (`publishCombatState` is `mode !== 'dm'` guarded; player ports never write `combat`/combat-fields during combat). New combat-affecting writes MUST follow this: compute on DM, broadcast via the existing combat snapshot; never reintroduce a player-side authoritative write.
- **Encoding: UTF-8, no BOM. Comments/strings in existing voice (Chinese where the file is Chinese).**

### Grounding Assets (global)
- `BUG_REPORT_2026-06-17_COMBAT_SYNC.md` (DECISION-RECORD/informs — upstream's own intent)
- `COMBAT_SYNC_WORKFLOW.md` (DECISION-RECORD/informs — the authority principles new code must conform to)
- `src/pages/MapsPage.tsx` (CONTRACT/binds — the live engine; every A/C/D/F turn+UI fix lands here)
- The 2026-06-19 completeness report (DECISION-RECORD/informs — the gap list with file:line)

### Execution
Serial, in the main session, in dependency order. After each task: run build + test, report, then next.

**Execution order (revised after plan-review):**
`T2 → T1 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14 → T15`
T2 (the guarded-advance helper + timer lifecycle) MUST land before T1, because T1's npc auto-skip routes through T2's `requestAdvance()` — shipping T1 first would inject an UNGUARDED auto-advance into the exact concurrency surface T2 exists to fix.

### ⚠️ Grounding caveat (from plan-review)
`MapsPage.tsx` is **~7021 lines**; the file:line citations below are ~250-300 lines stale (written off the audit baseline). They locate the right *symbols* but the implementer MUST grep/Read for the symbol, not jump to the literal line. Specific corrections already folded into the task specs below. The dead-framework constraint is respected by all tasks (verified — no task imports/deletes the three dead modules).

### Already fixed upstream — explicitly OUT of scope (do not re-implement)
Plan-review flagged these audit items as silently omitted. They are confirmed **FIXED by the 34 upstream combat-sync commits**, not gaps:
- **A3** (dodge 15s timeout), **A5** (enemy attack-then-move 2nd-AP).
- **E2** (player combat-field writes blocked during combat), **E3** (AP fresh-loadShared, no stale 3-way diff), **E5** (DM token position preserved), **E12** (round AP reset single DM-only).
No task touches these; they are the baseline we build on.

---

## T1 — NPC/障碍回合死锁解除 (DM 权威自动跳过非行动者)  [P0 / M]

### Summary
Make the DM-authoritative turn driver auto-skip live non-actor tokens (npc/obstacle) so an npc's turn can never hang the round, eliminating the player-side unrecoverable deadlock.

### Context
BUG③ / audit A1, A2. `buildInitiativeOrder` (MapsPage.tsx:~399) only excludes `type==='obstacle'`, so npc tokens enter initiative. The turn-driver effect (MapsPage.tsx:5768-5805) has branches only for missing token (prune), dead token (50ms skip), and enemy turn (schedule) — there is NO branch for a live non-player/non-enemy actor, so line 5798 `if (!isDM || !isEnemyTurn || !currentInitiativeToken) return` returns and nobody advances. Player "end turn" is disabled (`canControlPlayerTurn` requires a player-type current token), so only the DM manually clicking "下一位" can escape — players are hard-deadlocked.

### Grounding Assets
- `src/pages/MapsPage.tsx` (CONTRACT/binds — turn driver effect 5768-5805; `buildInitiativeOrder` ~399; `isEnemyTurn` ~1331)
- `src/lib/combatTokens.ts` (REFERENCE/requires — `isTokenAlive` ~27, `pruneInitiativeForToken` ~76)

### Acceptance Criteria
- [ ] AC1: In the DM turn-driver effect, when the current initiative token is alive AND `token.type` is neither `'player'` nor `'enemy'` (npc/obstacle), the driver auto-advances (mirrors the dead-token 50ms skip path) instead of returning at 5798.
- [ ] AC2 (journey): DM starts combat with order [player, npc, enemy]. When the round reaches the npc, the turn advances to the enemy automatically within ~100ms with NO manual click, on BOTH the DM screen and a player screen (the advance is DM-authored and broadcast via the combat snapshot). Verify by reading the broadcast index changes.
- [ ] AC3 (both branches): if the non-actor token is DEAD → existing dead-skip path handles it (unchanged); if ALIVE and non-actor → new auto-skip path. A `'player'`/`'enemy'` token still routes to its existing player/enemy branch (no behavior change — regression anchor).
- [ ] AC4 (no infinite loop): if initiative contains ZERO player-or-enemy actors (all npc/obstacle), the driver must NOT spin forever — it advances at most one full cycle then stops (guard via a per-`round-index-token` key set, reusing the `enemyAppliedKeysRef` pattern) and leaves the round parked rather than looping.
- [ ] AC5 (manual smoke): with serve:dm + serve:player, place an npc between two players, start combat, end the first player's turn → confirm the npc is skipped and the next player's turn begins on the player screen with no stall.

### Technical Approach
- In the effect at MapsPage.tsx:5793-5798, after the `!isTokenAlive` dead-skip block and before the `isEnemyTurn` gate, insert: `if (token.type !== 'player' && token.type !== 'enemy') { <guarded auto-advance> }`. Use a dedupe key (e.g. `nonactor-${round}-${initiativeIndex}-${token.id}`) added to a ref set to satisfy AC4.
- Auto-advance MUST go through T2's `requestAdvance()` guarded helper (T2 lands first — see execution order). Do NOT ship an interim unguarded `setTimeout(advanceInitiativeCore,50)`.
- Decision: auto-SKIP (not exclude npc from `buildInitiativeOrder`) — preserves the DM's ability to keep an npc slot for manual narration while never blocking the engine.
- Extract the skip-decision as a pure helper (e.g. `decideTurnAction(token, chars): 'skip'|'enemy'|'player'|'prune'`) so T13 can unit-test it without mounting the component.

### Edge Cases
- Player port must not need to do anything — verify the advance comes from DM and the player's combat snapshot updates (no player-side advance write).
- StrictMode double-invoke: the dedupe key set prevents a double 50ms schedule.
- Obstacle tokens: already excluded from initiative by `buildInitiativeOrder`; this branch is defensive for any non-player/non-enemy that slips in.

### Complexity
M — single effect branch + dedupe key + cross-end verification.

### Dependencies
**T2** (uses `requestAdvance()`; T2 lands first).

---

## T2 — 回合引擎定时器生命周期 + 重入正确性  [P0 / L]

### Summary
Make the enemy-turn timer chain safe across map-switch/unmount and concurrent advance paths: clear timers on teardown, route every advance through one reentrancy-guarded helper, and stop stale strikes from re-firing after a round change.

### Context
Audit A4, A6, A7, A8, A9, A10, A11, A12. The live engine drives enemy turns with `window.setTimeout` chains; `clearEnemyTurnTimers` (MapsPage.tsx:~4198) is called ONLY in `startCombat`/`endCombat`. There is no unmount cleanup and no `activeMap.id`-change cleanup → switching maps mid-enemy-turn leaves old timers firing against the now-active map's `initiativeOrderRef`/`enemyAppliedKeysRef` (cross-map pollution); unmount leaks timers (A8). The reentrancy guard `advancingTurnRef` protects only the manual `advanceInitiative` wrapper (5240-5245), NOT the automatic callers (5774, 5789, 5794, 5843, `advanceEnemyIfCurrent` ~5959, inner setTimeout) → manual + timer, or two death-skip effects, can run `advanceInitiativeCore` concurrently (A10/A12). `actKey`/`enemyTurnKey` are built from captured `round`/`initiativeIndex` (5800, ~4934) and timers aren't cleared on `nextRound()`, so a late strike that fires after the round wrapped to index 0 onto the same enemy passes the live-token check and double-advances (A7/A4). Prune branches write refs inside `setInitiativeOrder` updaters (5782-5788) → StrictMode double-invoke desync (A9). Prune-to-0 onto an already-acted token can stall at index 0 (A11). Pending-death key clearing is gated on a future `DiceRollOverlay onDone` that may never come (A6).

### Grounding Assets
- `src/pages/MapsPage.tsx` (CONTRACT/binds — `clearEnemyTurnTimers` ~4198, `startCombat` ~4290, `endCombat` ~4347, `advanceInitiativeCore` 5182-5245, turn-driver 5768-5846, `scheduleEnemyTurn`/`advanceEnemyIfCurrent` ~4930-4960, map-switch effects ~1078-1100)
- `src/lib/combatTokens.ts` (REFERENCE/requires — `pruneInitiativeForToken`)

### Acceptance Criteria
- [ ] AC1 (A8): a cleanup effect clears `enemyTurnTimersRef` (via `clearEnemyTurnTimers()`) on component unmount AND whenever `activeMap?.id` changes. After a map switch, a timer scheduled on the old map never calls `advanceInitiativeCore`/`scheduleEnemyTurn` (verify: timer ref set is empty post-switch).
- [ ] AC2 (A10/A12): introduce ONE guarded advance helper, e.g. `requestAdvance()`, that no-ops if `advancingTurnRef.current` is set, else sets it, runs `advanceInitiativeCore()`, and clears it in a `finally`/microtask. EVERY automatic advance site calls `requestAdvance()`: the prune-timer (~5789), dead-skip (~5794, ~5843), the empty-entry call (~5774), the `advanceEnemyIfCurrent` path, AND the recursive self-call INSIDE `advanceInitiativeCore` (~5208) — or that recursion is documented as exempt with reasoning. The manual `advanceInitiative` wrapper uses the same guard. Two concurrently-scheduled advances result in exactly ONE index increment (unit test).
- [ ] AC3 (A7/A4): on `nextRound()` (and on any round increment), pending enemy-turn timers are cleared so a stale second-strike cannot fire into the new round; the enemy-turn dedupe key includes `round` AND the strike callback re-checks the live round before resolving (a strike whose captured round != current round aborts).
- [ ] AC4 (A9): prune branches no longer write `initiativeIndexRef`/`initiativeOrderRef` or call `setInitiativeIndex` from INSIDE a `setInitiativeOrder` updater — ref writes happen at effect top-level after computing the pruned result; under StrictMode double-invoke the index stays consistent with state (unit test on the prune helper).
- [ ] AC5 (A11): when prune resets the index to 0 and index 0 points at a token that already acted this round (its dedupe key present), the driver force-advances past it instead of stalling (covered by the guarded helper + a "already-acted ⇒ advance" check). Unit test: a queue pruned to a single already-acted token does not deadlock.
- [ ] AC6 (A6): the pending-death key is cleared by a bounded fallback — a watchdog timer of a NAMED constant `DEATH_KEY_WATCHDOG_MS` (set ≥ the dice overlay's max visible window, e.g. 5000) that clears the key and re-runs `tryEndCombatIfNeeded` if no `DiceRollOverlay onDone` arrives. The clear is IDEMPOTENT (clear-once guard) so a late `onDone` arriving AFTER the watchdog does NOT double-end combat. Test: (a) `pendingDeathKeysRef` non-empty + no overlay completion ⇒ combat ends after the watchdog; (b) watchdog fires then onDone arrives ⇒ combat ends exactly once.
- [ ] AC7 (regression): existing enemy-attack flow (single + double strike, dodge) still resolves correctly; the 44 baseline tests stay green.

### Technical Approach
- Add `useEffect(() => () => clearEnemyTurnTimers(), [])` for unmount and extend/add a `useEffect(..., [activeMap?.id])` that clears timers on map change.
- Extract `requestAdvance()` near `advanceInitiativeCore`; replace all bare `advanceInitiativeCore()` auto-calls with it. Keep `advancingTurnRef` as the single guard.
- In `nextRound` (MapsPage.tsx ~5160) call `clearEnemyTurnTimers()` before scheduling the next round; have the second-strike callback capture `round` and compare to `roundRef.current` (add a `roundRef` if absent) before applying.
- Refactor the two prune sites to compute `pruneInitiativeForToken(...)` first, then assign refs + `setInitiativeIndex` + `setInitiativeOrder(pruned.order)` at top level.
- For A6, store the death-key timestamp and add a watchdog in `tryEndCombatIfNeeded`'s effect with a clear-once guard.
- **Extraction deliverable (for T13):** factor `requestAdvance`'s guard logic and the prune-recovery decision into pure/testable units (e.g. `pruneRecovery(order, index, round, actedKeys)`), so T13 can test reentrancy + prune-to-0 recovery without the component.

### Edge Cases
- Do not clear timers on every render — only on unmount and real `activeMap.id` change.
- `requestAdvance` must clear the guard even if `advanceInitiativeCore` throws.
- Round comparison must use a ref, not the captured closure value.

### Complexity
L — touches the most delicate part of the god-object; multiple interacting timers.

### Dependencies
None. T1's auto-skip should call `requestAdvance()` once this lands (coordinate).

---

## T3 — DOT 每回合掉血 + 眩晕跳回合  [P0 / M]

### Summary
Make burning/ignite/poison deal HP damage each round tick, and make stun actually skip the stunned unit's turn.

### Context
Audit C1 (critical), C2 (high). The round tick (MapsPage.tsx:5087-5134) only DECREMENTS status counters — no HP loss anywhere for burning/ignite/poison (C1: three DOT statuses are purely decorative). Stun (stunTurns) is set/decremented/VFX'd but neither the turn driver (5768-5805) nor `planEnemyTurn` reads it, so stunned units act normally (C2).

### Grounding Assets
- `src/pages/MapsPage.tsx` (CONTRACT/binds — round tick 5079-5142, turn driver 5793-5805, damage helper `applyDamageToToken`/`applyAttackDefenseDamageModifier` ~3324)
- `src/lib/burning.ts`, `src/lib/poison.ts`, `src/lib/ignite.ts` (REFERENCE/requires — current per-status constants; DOT magnitude lives here)
- `src/lib/enemyAi.ts` (REFERENCE/requires — `planEnemyTurn` ~160, must respect stun)

### Acceptance Criteria
- [ ] AC0 (BLOCKER precondition): BEFORE writing any DOT HP change, VERIFY the round-tick effect is DM-only. If it is not already `mode==='dm'`-guarded, add `if (mode !== 'dm') return` at the top of the tick. Proof required: a player screen's tick must NOT apply DOT locally. (Without this, DOT double-applies on both ends — the primary hazard of this task.)
- [ ] AC1 (C1): in the round tick, for each token with `burningTurns>0` / `igniteTurns>0` / `poisonTurns>0`, apply a per-tick HP loss to the token (and mirror to its linked Character `currentHp` when `characterId` set) via the existing damage path, BEFORE decrementing the counter. The per-tick magnitudes are **new** named constants ADDED to `burning.ts`/`poison.ts`/`ignite.ts` (today those files have only icon/label/turns consts — no damage value exists yet); they become the single source of truth.
- [ ] AC2 (C1 both branches): a token with a DOT counter > 0 loses exactly the configured HP that tick; a token with the counter == 0 loses nothing (regression anchor). DOT damage routes through the same death/defeat detection so a token reduced to 0 by DOT is marked defeated and skipped (ties to T1/T2 skip).
- [ ] AC3 (C1 sync): DOT is DM-authoritative — the HP change is computed on the DM and broadcast (no player-side DOT write). On a player screen the HP drops via the broadcast snapshot, not a local tick.
- [ ] AC4 (C2): the turn driver and `planEnemyTurn` treat a unit with `stunTurns>0` as a skipped actor — the unit's turn auto-advances (via T2's `requestAdvance`) and no enemy action is planned; a combat-log entry notes the skip.
- [ ] AC5 (C2 both branches): `stunTurns>0` ⇒ skip + advance; `stunTurns==0` ⇒ normal turn (regression anchor). Stun decrement still happens at round tick so the unit recovers after the configured rounds.
- [ ] AC6 (journey): DM ignites an enemy (igniteTurns=3) and stuns it (stunTurns=1). Next round: enemy takes burn damage AND its turn is skipped; following round: enemy takes burn damage and acts normally (stun expired). Verify HP and turn order on DM + player screens.

### Technical Approach
- In the tick loop (~5087-5134), for the DOT branches add `applyDamageToToken(...)` (or the existing token-HP damage util) with the per-status constant. The DM-only guard (AC0) is mandatory, not "if needed". Reuse the death-marking the normal damage path already triggers.
- **Extraction deliverable (for T13):** put the "compute DOT for a token" as a pure function `dotDamageFor(token): number` so T13 can test both branches (counter>0 ⇒ damage, ==0 ⇒ 0) without the component.
- For stun: in the turn driver, before scheduling an enemy or beginning a player turn, check `currentInitiativeToken`'s `stunTurns>0` and route to `requestAdvance()` + log. In `planEnemyTurn`, early-return a "skip" result if the acting enemy is stunned (defensive — the driver should already skip).
- Keep stun decrement in the round tick (already present at 5111).

### Edge Cases
- Apply DOT before decrement so a 1-turn DOT still deals its tick.
- Avoid double-counting if both token and linked character paths run — apply once to the authoritative HP and mirror.
- Stun on a PLAYER token must also skip (player can't act while stunned) — ensure the player begin-turn effect (5807-5836) respects stun and the player UI shows skipped.

### Complexity
M — two mechanics, but both hook existing tick + driver.

### Dependencies
T1 (shares the non-actor/skip advance path), T2 (`requestAdvance` guarded helper).

---

## T4 — 脆弱/束缚生效 + 敌人 condition 镜像 + restrained∪no-move 合并  [P1 / M]

### Summary
Wire `vulnerableTurns` into damage calc, make `restrainedTurns` lock movement + grant disadvantage (merging it with the duplicate `noMoveTurns`), and mirror status conditions onto enemy tokens (not only character-linked tokens).

### Context
Audit C3, C4, C5, C8. `vulnerableTurns` is set/decremented/label-synced but no damage calc reads it (C3 — promised "defense -25%" never applied). `restrainedTurns` has no mechanical effect (C4) and duplicates the working `noMoveTurns` (C8). Condition sync runs only when `token.characterId` is set (5139), so enemies — the main status recipients — get no `conditions[]` mirror, and there's no reverse sync (C5).

### Grounding Assets
- `src/lib/combatStats.ts` (CONTRACT/binds — `applyAttackDefenseDamageModifier` at **combatStats.ts:239**; vulnerable multiplier lands here. NOTE: MapsPage:~3324 is `applyDamageToToken`, which CALLS this — the modifier math is in combatStats.ts, not MapsPage.)
- `src/pages/MapsPage.tsx` (REFERENCE/requires — movement gate ~3790 / player path ~5421 read NO_MOVE only; condition sync ~5139)
- `src/store/maps.ts` (REFERENCE/requires — Token status fields ~101)

### Acceptance Criteria
- [ ] AC1 (C3): the damage path multiplies incoming damage to a token with `vulnerableTurns>0` by the documented factor (defense −25% ⇒ ×1.25 taken, as a single named constant); `vulnerableTurns==0` ⇒ unchanged (regression anchor). Unit test on the damage-modifier function for both branches.
- [ ] AC2 (C4): a token with `restrainedTurns>0` cannot move (movement gate rejects it, same as `noMoveTurns`) AND attacks against/by it apply (dis)advantage per the documented rule; `restrainedTurns==0` ⇒ free movement.
- [ ] AC3 (C8): `restrainedTurns` and `noMoveTurns` no longer both exist as parallel "can't move" fields — either `restrainedTurns` is wired into the SAME movement gate as `noMoveTurns` (preferred, keeping both fields but one gate) or `noMoveTurns` is folded into restrained; the chosen approach is documented and there is exactly one movement-lock check.
- [ ] AC4 (C5): the condition mirror runs for enemy tokens too (not gated on `characterId`); an enemy with `restrainedTurns>0`/`vulnerableTurns>0`/`stunTurns>0` shows the corresponding label in its detail panel sourced from the authoritative `*Turns` fields. Sync is one-way from authoritative `*Turns` ⇒ display labels (no drift).
- [ ] AC5 (journey): DM restrains + marks vulnerable an enemy. The enemy cannot move on its turn, takes +25% damage from the next hit, and its panel shows 束缚/脆弱. Verify on DM + player.

### Technical Approach
- Add a `vulnerable` multiplier read in `applyAttackDefenseDamageModifier`/`combatStats.ts` keyed on the defender token's `vulnerableTurns`.
- Extend the movement gate (currently NO_MOVE only at ~3790/5421) to also reject when `restrainedTurns>0`; keep `noMoveTurns` working. Add the (dis)advantage hook where attack rolls are computed.
- Generalize the condition-mirror block (5139) to compute display labels for ALL tokens from `*Turns` fields, not just `characterId` ones.

### Edge Cases
- Vulnerable stacking with other defense modifiers — define order (apply vulnerable last).
- Don't double-lock movement if both restrained and no-move set.

### Complexity
M.

### Dependencies
None (independent of T1-T3, but touches the same status fields as T5 — order T4 before T5).

---

## T5 — 状态数据卫生 (单一标签源 / 注册表补全 / condition 选项 / emoji / calm+stableMind 收尾)  [P1 / S]

### Summary
Collapse duplicated status labels to one source, complete `TOKEN_STATUS_DEFS`, reconcile `CONDITION_OPTIONS` with the effective set, distinguish burning/ignite emoji, and finish the calmMind/stableMind smells.

### Context
Audit C6, C7, C9, C10, C11. `'燃烧'` is hardcoded in ≥3 places (tokenStatus.ts:8/38, MapsPage STATUS_LABEL:354) and MapsPage uses its own `STATUS_LABEL` bypassing the central registry (C6). `TOKEN_STATUS_DEFS` covers 5 of 8 statuses (missing restrained/vulnerable/no-move) (C9). `CONDITION_OPTIONS` (types/character.ts:183-199) lists 15 inert conditions and omits the effective ones (脆弱/无法移动) (C7). burning + ignite share 🔥 (C10). `calmMind.focusedSpiritOnHit` never consumes uses; `stableMind.ts:36` uses a blocking `window.confirm` (C11).

### Grounding Assets
- `src/lib/tokenStatus.ts` (CONTRACT/binds — the registry that should be the single source)
- `src/pages/MapsPage.tsx` (REFERENCE/requires — `STATUS_LABEL`/`*_STATUS_LABEL` consts ~354 to be removed in favor of the registry)
- `src/types/character.ts` (REFERENCE/requires — `CONDITION_OPTIONS` 183-199)
- `src/lib/calmMind.ts`, `src/lib/stableMind.ts` (REFERENCE/requires)

### Acceptance Criteria
- [ ] AC1 (C6): every status label is read from one source (extend `TOKEN_STATUS_DEFS` and import it in MapsPage). The inline `STATUS_LABEL`/`RESTRAINED_/VULNERABLE_/NO_MOVE_STATUS_LABEL` consts (~354-357) are deleted ONLY AFTER every reference (incl. T4's movement gate at ~3790/5421 and condition-mirror at ~5139) is migrated to the registry — tsc must stay green (no dangling reference). `grep "'燃烧'"` returns exactly one definition.
- [ ] AC2 (C9): `TOKEN_STATUS_DEFS` includes all real token status fields (knockback, burning, ignite, poison, stun, restrained, vulnerable, no-move). FIRST grep every iterator of `TOKEN_STATUS_DEFS` (VFX/legend loops) and assert none break when the 3 newly-added entries appear (e.g. a VFX loop that assumed only the mechanically-animated set must filter, not crash).
- [ ] AC3 (C7): `CONDITION_OPTIONS` is reconciled — the mechanically-effective conditions (脆弱, 无法移动, 束缚, plus the DOT/stun set) are present; conditions with zero engine effect are either removed OR clearly marked as cosmetic-only (decision documented in the file). Both directions covered.
- [ ] AC4 (C10): burning and ignite use distinct emoji/icons (e.g. 🔥 vs 🔆 or a variant) — visually distinguishable in the legend and on-token.
- [ ] AC5 (C11): `stableMind` no longer uses blocking `window.confirm` (replace with the existing dodge-style async DM-resolved prompt or a non-blocking choice); `calmMind.focusedSpiritOnHit` either consumes uses correctly or is explicitly documented as an intended passive (no half-built state). Existing calmMind/stableMind tests stay green.

### Technical Approach
- Move all label/emoji constants into `tokenStatus.ts` `TOKEN_STATUS_DEFS`; export helpers; replace MapsPage inline consts.
- Add the 3 missing registry entries.
- Edit `CONDITION_OPTIONS` per AC3 with an inline comment recording the cosmetic-vs-effective split.
- Swap `stableMind`'s `window.confirm` for the async prompt pattern used by shared dodge.

### Edge Cases
- Changing emoji must not break any equality check on the emoji string elsewhere (grep first).
- Removing MapsPage consts: ensure all references migrated (tsc will catch).

### Complexity
S — mostly data/consts, but spread across files.

### Dependencies
T4 (T4 adds restrained/vulnerable display labels; T5 finalizes the registry that holds them).

---

## T6 — 怪物结构化攻击 schema + 全 24 怪 derived stats + HP 真相源统一  [P0 / L]

### Summary
Add machine-readable attack fields to monster stat blocks (`{toHit, damageDice, damageType, range, kind}`), populate them for all 24 monsters, ensure all 24 produce derived combat stats, and unify the HP source of truth.

### Context
BUG① / audit B1, B2, B9, B10. `MonsterAction` (enemyStatBlocks.ts:10-13) is only `{name, description}` — attack numbers live as Chinese prose (B2). `getEnemyDerivedCombatStats` returns undefined unless the block has `equipment`; only goblin+hobgoblin have it, so 22/24 monsters have no derived stats and the detail panel's combat block doesn't render (B1). Derived HP formula ignores CR/template HP (hobgoblin derived 21 vs template 22) (B9). `EnemyStatBlock` has no HP field; HP truth is split between `ENEMY_POOL[].maxHp` and the derived formula (B10).

### Grounding Assets
- `src/lib/enemyStatBlocks.ts` (CONTRACT/binds — `MonsterAction`/`EnemyStatBlock` interfaces 10-32, all 24 blocks; prose already contains the numbers to encode)
- `src/lib/enemyCombatStats.ts` (REFERENCE/requires — `getEnemyDerivedCombatStats` ~79, gated on equipment)
- `src/lib/combatStats.ts` (REFERENCE/requires — `computeMaxHp` ~129)
- `src/data/enemyPool.ts` or wherever `ENEMY_POOL` lives (REFERENCE/requires — template `maxHp`)
- `src/components/map/EnemyDetailPanel.tsx` (REFERENCE/requires — combat-stats render consumer)

### Acceptance Criteria
- [ ] AC1 (B2): `MonsterAction` gains optional structured fields `{ toHit?: number; damageDice?: string; damageType?: string; range?: number; kind?: 'melee'|'ranged'|'aoe'; save?: {ability, dc} }`. The interface change compiles; the prose `description` is retained for display.
- [ ] AC0 (parity precondition): `ENEMY_POOL` and `ENEMY_STAT_BLOCKS` do NOT have the same membership (the stat-block set is a superset / they diverge). FIRST establish the authoritative id list and add a test asserting pool↔stat-block id parity (or an explicit documented allowlist of pool-only / block-only ids). State the REAL count in the spec — do not assume "24".
- [ ] AC2 (B1/B2 data): every monster's PRIMARY attack action has the structured fields populated from its existing prose (e.g. goblin 弯刀 ⇒ `{toHit:4, damageDice:'1d6+2', damageType:'slashing', kind:'melee', range:5}`). A data-shape test asserts EVERY stat block (per the AC0 authoritative list) has at least one action with `damageDice` set.
- [ ] AC3 (B1 derived): every monster (per AC0) produces derived combat stats usable by the panel/AI — either `getEnemyDerivedCombatStats` no longer hard-requires `equipment` (falls back to abilities + structured action), or the panel reads the structured action directly. The EnemyDetailPanel combat block renders a to-hit + damage for ALL monsters (manual smoke per a sample of 5 incl. ogre/owlbear).
- [ ] AC4 (B9/B10): a single HP source of truth — `EnemyStatBlock` gets an explicit `hp`/`maxHp` field (or the derived formula is reconciled to the template), so the picker HP, the spawned token HP, and the panel HP agree for every monster (test: for goblin+hobgoblin and 3 others, picker HP == spawned token `maxHp`).
- [ ] AC5 (regression): goblin/hobgoblin existing equipment-derived behavior is unchanged or improved (not regressed); existing tests green.

### Technical Approach
- Extend `MonsterAction`/`EnemyStatBlock` interfaces; hand-author structured fields per monster from the prose (24 blocks, primary + notable secondary actions like breath).
- Relax `getEnemyDerivedCombatStats` to compute from abilities + the primary structured action when `equipment` is absent (keep equipment path for goblin/hobgoblin).
- Add `maxHp` to `EnemyStatBlock` and make `enemyTemplateToTokenPatch` + picker + panel read one source; reconcile `computeMaxHp` to honor template/CR.

### Edge Cases
- Monsters with multiple attacks (multiattack) — pick a documented "primary" for AI; keep all in prose.
- AOE/save attacks (wyrmling breath) — encode `kind:'aoe'` + `save` for T7 to consume.
- Don't break the `dndAbility` mapping used for derived math.

### Complexity
L — interface change + 24-monster data authoring + derived-stat relaxation + HP unification.

### Dependencies
None. T7 depends on this.

---

## T7 — 敌人 AI 按真实攻击数据 + npc 目标 + 绿龙吐息 + 死分支/回退告警/AC默认/文本卫生  [P1 / M]

### Summary
Make enemy AI roll each monster's real attack (from T6's structured data) instead of a global 1d6, target npc/friendly tokens, drive the green wyrmling's breath, remove dead branches, warn on stale-poolId fallback, unify AC defaults, and clean stat-block text.

### Context
Audit B3, B4, B5, B6, B7, B8, B11, B12. AI uses one hardcoded `ATTACK_DICE={count:1,sides:6}` for all monsters (B3); `MapsPage.inferEnemyDamageDiceCount` reads the always-`1d6` label so damage collapses (B4). `isPlayerToken` is strictly `type==='player'` so npc allies are never targeted (B5). Only `wyrmling-red` has an AOE branch; green's 6d6 breath is dead data (B6). `targetTokenPatch` has a consumer but no producer (B7). AC defaults differ across 4 files (10/12/20/12) (B8). Stale `poolId` silently falls back to dexBonus 2 with no warning (B11). Stat-block text has untranslated/leading-space fragments (B12).

### Grounding Assets
- `src/lib/enemyAi.ts` (CONTRACT/binds — `ATTACK_DICE` ~18, `buildEnemyAttack` ~120, target filter ~167, AOE special-case ~175, `enemyMeleeDexBonus` ~49)
- `src/lib/gridCombat.ts` (REFERENCE/requires — `isPlayerToken` 258-260)
- `src/pages/MapsPage.tsx` (REFERENCE/requires — `inferEnemyDamageDiceCount` ~4491, `resolveEnemyDamageDice` ~4510, `targetTokenPatch` consumer ~4735)
- `src/lib/enemyStatBlocks.ts` (REFERENCE/requires — T6's structured fields are the input)

### Acceptance Criteria
- [ ] AC1 (B3/B4): the collapse is in `buildEnemyAttack` (enemyAi.ts:~111) hardcoding the global `ATTACK_DICE={1,6}` into the attack LABEL, so melee labels are always "1d6". Fix: `buildEnemyAttack` sources the label/dice from the monster's T6 structured `damageDice`/`damageType`/`toHit`. (`inferEnemyDamageDiceCount` at MapsPage:~4491 already correctly parses `\d+d\d+` from the label — it is NOT broken; do not change it.) ogre/owlbear/goblin each then roll their own dice (test: AI attack for 3 distinct monsters yields 3 distinct damageDice).
- [ ] AC2 (B5): `isPlayerToken` (or the AI target filter) targets player AND npc/friendly tokens (define "hostile-to-enemy" set); an encounter with only npc allies no longer no-ops — the enemy attacks the npc. Both branches: with a player present, player targeting unchanged (regression anchor); with only npc, npc is targeted.
- [ ] AC3 (B6): `wyrmling-green` uses its breath (6d6 poison + save) via a data-driven AOE branch keyed on the structured `kind:'aoe'`/`save` action (T6), not a `=== 'wyrmling-red'` string special-case. Both wyrmlings drive their breath from data.
- [ ] AC4 (B7): either `targetTokenPatch` is produced by the AI where intended, or the dead consumer branch (MapsPage ~4735) is removed. No write-only/read-only dangling field remains.
- [ ] AC5 (B8): AC default is a single shared constant `DEFAULT_ENEMY_AC` referenced by the **3** real AC-default sites — `enemyCombatStats.ts:~40` (`??12`), `combatStats.ts:~100` (`??10`), `AIPage.tsx:~160` (`12`) — reconciled to ONE value. Do NOT touch `EnemyDetailPanel.tsx:~45` `??20`, which is a **maxHp** fallback, not AC. `grep` shows one AC-default definition.
- [ ] AC6 (B11): a stale/unknown `poolId` fallback (`enemyMeleeDexBonus` enemyAi.ts:~49, falls through to `2`) logs a `console.warn` once per token id via a module-level Set; that Set is CLEARED on combat end (lifecycle defined) so it cannot grow unbounded.
- [ ] AC7 (B12): the cited untranslated/leading-space fragments in enemyStatBlocks.ts (`' blindsight'`, `'slashing'`, `'difficult'`, `'piercing'`, `'horns'`, `'dispel magic'`, `'黑暗vision'`) are corrected to consistent Chinese/clean text.

### Technical Approach
- Replace `buildEnemyAttack`'s global `ATTACK_DICE` with the monster's structured primary action; label the attack with the real dice so `inferEnemyDamageDiceCount` reads it.
- Broaden the target predicate to a "hostile target" check; keep enemy-vs-enemy exclusion.
- Generalize the AOE branch to fire on any action with `kind:'aoe'`+`save`.
- Introduce `DEFAULT_ENEMY_AC` constant; replace the 4 literals.
- Add a guarded `console.warn` in `enemyMeleeDexBonus`/AC fallback.
- Fix the text fragments.

### Edge Cases
- Monster with no structured action (should not exist post-T6) ⇒ safe fallback + warn (B11 path).
- Multiattack: AI uses the primary; document.
- Don't let npc-targeting make enemies attack other enemies.

### Complexity
M.

### Dependencies
T6.

---

## T8 — 地图选中态正确性 + 占格/拖拽阈值/自动 fit/hover/键盘/HP条缩放  [P1 / M]

### Summary
Clear selection on delete/death/map-switch, reject overlapping drops, add a drag threshold, auto-fit each map, fix the hover race, add keyboard move/delete, and scale the HP bar with zoom.

### Context
Audit D1, D2, D3, D4, D5, D6, D7, D10, D13. Box-delete and death don't clear `selectedTokenId`; dead-but-present tokens keep the dashed ring (D1). Only the DM dropdown clears selection on map switch — programmatic/remote switches don't (D2). No occupancy check on drop ⇒ tokens stack, lower one unselectable (D3); no z-reorder (D4). No drag threshold ⇒ 1px jitter commits a move + broadcast (D5). `fittedRef` one-shot + reused instance ⇒ later maps never auto-fit (D6). Hover updater mixes boolean + functional set ⇒ flicker race (D7). Reconcile tween not cancelled ⇒ stacked `node.to` (D10). No keyboard move/delete; HP bar geometry hardcoded px (D13).

### Grounding Assets
- `src/components/map/MapCanvas.tsx` (CONTRACT/binds — drop ~1223, hover ~1218, fit ~696/845, reconcile tween ~1671-1698, HP bar ~1725/2005, selection ring ~1922)
- `src/pages/MapsPage.tsx` (REFERENCE/requires — `selectedTokenId` state, map-switch ~6462, keydown handler ~1798, MapCanvas render ~5971 needs `key`)
- `src/lib/gridCombat.ts` (REFERENCE/requires — `resolveTokenDropPosition` ~128, `occupiedCells` ~239)
- `src/store/maps.ts` (REFERENCE/requires — `removeToken` ~355; z-order is array order)

### Acceptance Criteria
- [ ] AC1 (D1): `selectedTokenId` is cleared when the selected token is deleted (box-delete `handleDeleteBoxConfirm` ~1011 + panel-delete) OR dies (HP→0 / defeated `defeatedTokenIds` memo ~1662); the dashed selection ring no longer renders on a dead/removed token. Regression anchor: the **6 existing** `setSelectedTokenId(null)` sites (~1309/3981/4181/5999/6464/6790) keep working — the new clears are additive.
- [ ] AC2 (D2): an effect watching `activeMap?.id` clears `selectedTokenId` on ANY map change (DM dropdown, programmatic `select()`, remote/player follow, `removeMap` auto-reselect) — not only the dropdown onChange.
- [ ] AC3 (D3): the manual drop path rejects (or repositions) a drop onto an already-occupied cell using `occupiedCells`; two tokens cannot share a cell center. Both branches: free cell ⇒ snap; occupied ⇒ rejected/nearest-free.
- [ ] AC4 (D4): a covered token is reachable — either click-cycling through stacked tokens OR a bring-to-front reorder exists (minimal: clicking an occupied cell cycles selection through its tokens). (If D3 fully prevents stacking, D4 is satisfied by construction — document which.)
- [ ] AC5 (D5): a drag under a small px threshold does NOT commit a move/broadcast (no displacement on a click/jitter); a drag beyond threshold commits as today.
- [ ] AC6 (D6): switching maps re-fits the new map to the viewport by **resetting `fittedRef` on `map.id` change** (PREFERRED over `key={activeMap.id}` remount — remount tears live `Konva.Animation` instances, drag-preview, view/scale, hover/measure state, the broadest blast radius). Each map auto-fits once on entry. If remount is chosen instead, the spec must enumerate every piece of dropped local canvas state and confirm it's safe.
- [ ] AC7 (D7): the hover handler uses a single consistent update style (functional or id-set); rapid hover in/out no longer flickers (no mixed boolean+functional set).
- [ ] AC8 (D10): the reconcile effect cancels/stops any in-flight tween before starting a new `node.to`; no stacked animations.
- [ ] AC9 (D13): a selected token can be moved with arrow keys (one cell) and deleted with Delete/Backspace. **(HP-bar-scaling DROPPED:** plan-review confirmed the HP bar renders INSIDE the Konva Stage, so its `radius*2` width AND the `6`/`-12` stage-coord constants already scale with zoom — the "fixed px, doesn't scale" premise was false. No HP-bar geometry change.)
- [ ] AC10 (journey): DM selects an enemy, presses Delete → token removed, ring gone; switches maps → no stale selection, new map auto-fits; drags a token 1px → no move; drags it 3 cells → moves once.

### Technical Approach
- Add an effect clearing selection on `activeMap?.id` change and in the death/defeat path; clear in box-delete handler.
- In `MapCanvas` drop, consult `occupiedCells` before committing; add a drag-distance threshold in `onDragMove`/`onDragEnd`.
- Reset `fittedRef.current = false` in an effect on `activeMap?.id` change (do NOT remount via `key`).
- Normalize the hover setter to one style.
- Stop the previous tween (`node.to` cancel / `node.getTweens?`) before reconcile.
- Extend the keydown handler (currently q/e rotation only) with arrow/delete for the selected token (HP bar geometry untouched — D13 scaling dropped).

### Edge Cases
- Keyboard handlers must not fire while typing in an input/textarea.
- `fittedRef` reset must run exactly once per map change (not every render).
- Occupancy: allow a token to "stay" on its own cell (don't reject self).

### Complexity
M.

### Dependencies
None (selection-on-death coordinates with T1/T3 defeat path — soft).

---

## T9 — 地图渲染卫生 (死代码 / blob URL / 动画节流 / mojibake)  [P2 / S]

### Summary
Delete the commented-out rageShot dead block, unify the blob-URL management, throttle/pause the always-on Konva animations, and repair the MapCanvas mojibake comments.

### Context
Audit D8, D9, D11, D12. ~33-line `rageShot` block is now block-commented in the hot attack path (D8). `useImage` + manual `createObjectURL` double-manage the same blob URL ⇒ tear/flash on fast switch (D9). Multiple always-on `Konva.Animation` (poison ~19-23 radial-gradient circles/token, burning/stun/etc.) with no throttle/pause ⇒ frame drops (D11). Mojibake comments at MapCanvas.tsx:599/625 (D12).

### Grounding Assets
- `src/pages/MapsPage.tsx` (REFERENCE/requires — commented rageShot block ~4079-4111)
- `src/components/map/MapCanvas.tsx` (CONTRACT/binds — blob URL ~690/810, animations ~2172/2222/2324/2389/2447/2651, mojibake comments 599/625)

### Acceptance Criteria
- [ ] AC1 (D8): the ~33-line `/* */` block-commented `rageShot` block (~4079-4111) is deleted. NOTE: there may ALSO be a separate live-but-dead `if (false && rageShot)` branch nearby — grep `rageShot` first; delete BOTH dead artifacts (commented block + any `if(false&&...)` branch), confirming neither is reachable.
- [ ] AC2 (D9): one mechanism manages each map's blob URL (drop the redundant `createObjectURL`/`revokeObjectURL` OR drop `useImage`), eliminating the double-management; fast map switching shows no tear/flash (manual smoke).
- [ ] AC3 (D11): the per-token status animations are throttled (cap frame rate) AND paused when the token/layer is not visible (e.g. animation stops when the affected token has no active status or is off-screen). Poison no longer animates ~20 gradient circles continuously when not needed.
- [ ] AC4 (D12): the mojibake comments at MapCanvas.tsx:599/625 are restored to correct UTF-8 Chinese (`静心角标`/`气喘角标` per context).
- [ ] AC5 (regression): visuals still render correctly for an actively-burning/poisoned/stunned token; build + tests green.

### Technical Approach
- Delete the commented block.
- Pick one blob-URL owner; remove the other.
- Add a frame-rate throttle to the `Konva.Animation` callbacks and gate `anim.start()/stop()` on status presence/visibility.
- Fix the two comments.

### Edge Cases
- Throttling must not freeze an active effect — keep it visibly animating, just cheaper.
- Ensure `revokeObjectURL` still runs on unmount to avoid leaks if `useImage` is kept.

### Complexity
S.

### Dependencies
None.

---

## T10 — 同步耐久:双 HP 真相源调和 + 墓碑防复活 + maps version/migrate + enemyAP 持久化  [P1 / M]

### Summary
Reconcile `Character.currentHp` with `token.hp`, add deletion tombstones to stop entity resurrection, version+migrate the maps store, and durably persist per-encounter enemy AP.

### Context
Audit E4, E11, E10, E13. `currentHp` (Character) and `token.hp` (map) are two independent stores over two channels, never reconciled (E4). No tombstones ⇒ a delete that lands in the `setTimeout(saveCharacters,0)` window or before a peer sees it gets re-hydrated by a concurrent full-array write (E11). `maps` store has no `version`/`migrate` (characters at version 19) (E10). `enemyApByToken` lives only in React state + combat resource ⇒ resets to default {2,2} on reload/torn read (E13).

### Grounding Assets
- `src/store/characters.ts` (CONTRACT/binds — damage ~1052, `remove` setTimeout(...,0) ~880, persist version 19 + migrate ~1257)
- `src/store/maps.ts` (CONTRACT/binds — Token.hp, `mergePlayerTokenCombatFields` ~42, `removeMap`/`removeToken` ~232/355, persist `{name:'stars-maps'}` ~364 no version)
- `src/pages/MapsPage.tsx` (REFERENCE/requires — `enemyApByToken` state/ref ~462, fallback {2,2} ~1647/3589/5165)

### Acceptance Criteria
- [ ] AC1 (E4 — RESCOPED): a one-way sync ALREADY exists (`syncTargetHp` at maps/MapsPage ~4553 mirrors `currentHp → token.hp` on damage; display `tokenHp()` ~1631 reads `currentHp`). Rescope: make this canonical — verify the sync fires on EVERY HP-change path (damage, heal, DOT from T3, dodge) and is not bypassed; for character-linked tokens a test asserts post-change `token.hp === character.currentHp`. Do NOT build a parallel reconciler — harden the existing one. (Non-character tokens have no currentHp by design — out of scope.)
- [ ] AC2 (E11): deletions write a tombstone (id + timestamp) that suppresses re-hydration for a bounded window; a concurrent full-array write from a peer that still contains the deleted entity does NOT resurrect it. The `remove` `setTimeout(...,0)` race is closed (save synchronously or guard with the tombstone). Test: delete then apply a stale shared snapshot containing the entity ⇒ entity stays deleted.
- [ ] AC3 (E10): the maps store gets a `version` + `migrate` (mirroring characters), so an old `stars-maps` localStorage shape loads without crashing; a migration test loads a v0 blob and produces a valid current shape.
- [ ] AC4 (E13 — RESCOPED): `enemyApByToken` is ALREADY a field of `SharedCombatState` (~175), published via `publishCombatState` (~906) and restored on load (~952-953) — it IS server-persisted. Rescope to VERIFY + HARDEN the torn/fresh-read case: a reload mid-encounter restores spent AP (test the restore path actually fires); only a genuinely-absent/torn snapshot falls back to {2,2} (documented). This is largely verification, NOT new persistence — if verification passes, the only delta is hardening the torn-read fallback. Reduce effort accordingly.
- [ ] AC5 (regression): existing characters migrate chain + 44 tests green.

### Technical Approach
- Centralize HP: make the DM damage path update token.hp and mirror currentHp (or vice versa) through one helper; remove the second independent write.
- Add a `tombstones` map (id⇒ts) consulted by the polling apply/merge; replace `setTimeout(saveCharacters,0)` with a synchronous save + tombstone.
- Add `version`/`migrate` to the maps persist config.
- Persist `enemyApByToken` into the DM-authored combat snapshot and restore on load.

### Edge Cases
- Tombstone GC — expire tombstones after the poll window so deleted ids can be reused.
- HP reconcile must not fight the existing combat-write block (DM-only).

### Complexity
M.

### Dependencies
None (HP reconcile coordinates with T3 DOT death path — soft).

---

## T11 — 服务端硬化:原子写锁 / 鉴权 / backlog+size cap / 图片配额孤儿 / safeName+API404 / player 单调 guard  [P2 / L]

### Summary
Add a cross-process write lock (on top of the existing atomic rename), real DM write authentication, request size limits + bounded event backlog, image quota + orphan cleanup, fix `safeName` collisions + API-miss 404, and a monotonic player-side apply guard.

### Context
Audit E1, E6, E7, E8, E9, E14. Atomic temp+rename exists but no cross-process lock ⇒ two servers' concurrent renames are OS last-writer-wins (E1). Player has no monotonic guard against stale shared applies (E6). Server has ZERO auth — any client hitting the DM port's `/api/state/*` PUT can write privileged resources; mode is port-inferred + spoofable (E7). No write size cap + 1200-event in-memory backlog fully replayed to every new subscriber (E8). Image storage in 3 places, no quota; player `removeMap` can't delete shared image (orphans), DM delete leaves player IndexedDB copy (E9). `safeName` collapses distinct names to one file; unmatched `/api/*` serves index.html/200 (E14).

### Grounding Assets
- `scripts/vite-server.mjs`, `scripts/static-server.mjs` (CONTRACT/binds — write path ~144/166, `safeName` ~36/67, `EVENT_BACKLOG_LIMIT` ~34, `readBody` ~46, API routing/static fallback ~227/241)
- `src/lib/sharedApi.ts` (REFERENCE/requires — `canWriteSharedState` ~72, image put/delete ~160/190)
- `src/lib/appMode.ts` (REFERENCE/requires — port-inferred mode ~24)
- `src/store/characters.ts`/`maps.ts` (REFERENCE/requires — `updatedAt` guard one-directional; player always-accepts)

### Acceptance Criteria
- [ ] AC1 (E1): writes to the same shared resource are serialized by a cross-process lock (lockfile or single-writer queue) so two concurrent writers cannot interleave/lose updates; the atomic rename is preserved. Test or documented manual: two rapid writes both persist (no lost update).
- [ ] AC2 (E7 — auth is OPT-IN, default OFF): auth is gated behind an env flag (e.g. `STARS_SHARED_SECRET` unset ⇒ auth disabled ⇒ ZERO change to today's flow, the no-regression anchor). When SET: the secret is required ONLY on writes to DM-authoritative resources (combat, and combat-fields), and the existing **player-writable allowlist is preserved** (sharedApi.ts:73-84 — players legitimately PUT characters/maps/dodge/dice/player-action; those must still succeed). Branches: flag off ⇒ all writes as today; flag on + valid secret ⇒ DM write ok; flag on + missing secret on a DM-only resource ⇒ 401/403; flag on + player writing an allowlisted resource ⇒ still ok. AC7 regression MUST include a player PUT succeeding in both flag states.
- [ ] AC3 (E8): PUT body has a max size (reject oversize with 413); the event backlog replay to a new subscriber is bounded (cap replay count, not full 1200).
- [ ] AC4 (E9): image deletion no longer orphans — a DM map delete removes the shared image AND signals players to drop their IndexedDB copy (or players GC orphans on load); a basic quota/limit is enforced. Document the chosen GC trigger.
- [ ] AC5 (E14): `safeName` no longer silently collapses distinct logical names (hash/encode to avoid collision). The unmatched-`/api/*`-returns-index.html/200 bug is in **static-server.mjs only** — fix it there to return 404; `vite-server.mjs` already returns 404 (~202-204), do NOT change it.
- [ ] AC6 (E6): the player apply path uses a monotonic guard (the existing `combatId`/`seq` or a new per-resource `seq`) so an out-of-order/stale shared snapshot is discarded on the player side; the module-level snapshot-equality short-circuit cannot suppress a legitimately newer apply.
- [ ] AC7 (regression): DM+player serve flow still syncs; 44 tests green.

### Technical Approach
- Add a lockfile (or in-process async mutex per resource keyed by file path) around the write+rename.
- Add an OPT-IN `STARS_SHARED_SECRET` env (unset ⇒ no auth ⇒ no regression); when set, require it ONLY on DM-authoritative resource writes, preserving the player-writable allowlist; client sends it from DM config.
- Cap `readBody` size; cap backlog replay.
- Add image GC on load + a delete-signal; enforce a max image count/size.
- Encode `safeName` collisions; in static-server.mjs return 404 for unmatched `/api/*` before the static fallback (vite-server already correct).
- Add a per-resource `seq` to shared writes; player discards lower `seq`.

### Edge Cases
- Lock must not deadlock on crash — use stale-lock timeout.
- Auth secret must never be committed (env only) — respects workspace secret rules.
- Windows file locking semantics differ — use a portable lock approach.

### Complexity
L — server + client + protocol change.

### Dependencies
None.

---

## T12 — 骰子收口:死代码+write-only字段 / 时序常量协调 / overlay共享模块 / 单一RNG伤害一致 / percentile修正  [P1 / M]

### Summary
Delete `d20Geometry.ts` + write-only fields, coordinate the dice timing constants so resolution always precedes advance, extract the duplicated dice-box overlay logic into one module, make the displayed dice value the SAME draw as the resolved damage, and fix the percentile 1-9 bug + its test.

### Context
Audit F1-F6. `d20Geometry.ts` (140 lines) is unreferenced dead code (F1). Four uncoordinated magic numbers (advance 3400ms vs HUD 4000ms vs 2600/2200ms visibility) ⇒ "resolve before advance" by luck (F2). `DiceBoxRollOverlay`/`DiceBoxD20Overlay` duplicate `FLY_OFFSETS`/FNV `stableIndex`/handshake (F3). Three independent `Math.random()` sources for the same conceptual roll ⇒ displayed value ≠ applied damage in the fallback path (F4). `percentileNotation` produces tens=0 for low values; the test locks the wrong output (F5). `DiceRoll.diceBoxResolved`/`D20AttackRoll.source` are write-only (F6).

### Grounding Assets
- `src/lib/d20Geometry.ts` (REFERENCE — delete target, F1)
- `src/components/DiceRollOverlay.tsx`, `DiceBoxRollOverlay.tsx`, `DiceBoxD20Overlay.tsx` (CONTRACT/binds — timing consts, duplicated FLY_OFFSETS/stableIndex, write-only fields)
- `src/pages/MapsPage.tsx` (REFERENCE/requires — `DICE_ROLL_MS` ~360, advance timers ~4976/5030/5059/5066, RNG sources ~390/822/855)
- `src/lib/archerCombat.ts` (REFERENCE/requires — its own RNG ~16/133)
- `src/lib/diceNotation.ts` + `diceNotation.test.ts` (CONTRACT/binds — percentile bug ~60-72; test asserts wrong output ~79)

### Acceptance Criteria
- [ ] AC1 (F1/F6): `d20Geometry.ts` is deleted (grep confirms zero importers first); `DiceRoll.diceBoxResolved` and `D20AttackRoll.source` are removed (grep confirms no readers) — fields with no consumer gone.
- [ ] AC2 (F2): `DICE_ROLL_MS` is **3200** (advance = `DICE_ROLL_MS+200`, already derived — not a raw literal). The real gap is CROSS-COMPONENT: HUD self-close `4000` (DiceRollOverlay.tsx:49) and visibility `2600`/`2200` (the two overlay components) are uncoordinated with MapsPage's advance. Fix: derive the advance delay so it is ≥ max(overlay visible window, HUD) by construction (share a constant/contract across the overlay + MapsPage), not coincidence. A comment documents the ordering invariant; assert advance delay ≥ resolution delay.
- [ ] AC3 (F3): the duplicated `FLY_OFFSETS` + FNV `stableIndex` + handshake are extracted into one shared module imported by both dice-box overlays (one definition).
- [ ] AC4 (F4 — DOWNGRADED): plan-review found the "3 independent RNG for the same roll" framing is a misread — MapsPage (~822 d20, ~855 damage) are the authoritative draws; `archerCombat.ts` randoms (~16/133) are `opts.d20 ?? rollD20()` FALLBACKS that don't execute when MapsPage supplies values. Rescope: REMOVE the dead/unused fallback randoms (dead code), OR — if a real path exists where the displayed value ≠ applied damage — cite it first, then fix. Do not "unify 3 RNGs" that aren't concurrent.
- [ ] ~~AC5 (F5)~~ — **DROPPED.** Plan-review confirmed the percentile 1-9 `tens=0` is a DELIBERATELY DOCUMENTED engine limitation (diceNotation.ts:12-15/60-66: a lone d100 is a tens-digit die, unrepresentable for 1-9; "not a gameplay path, exists for the AC5 smoke matrix only"), and the test (line 79) pins it intentionally with `// known limit`. Changing the math/test would BREAK a correct, documented contract. No change. (F5 is acknowledged-as-designed, not a gap.)
- [ ] AC6 (regression): dice overlays still render + resolve; all baseline tests green (percentile test UNCHANGED).

### Technical Approach
- Delete the dead file + fields after grep.
- Share a timing contract: `ADVANCE_DELAY ≥ max(overlay MIN_VISIBLE_ROLL_MS, HUD_MS) + ε`, coordinated across DiceRollOverlay + the two dice-box overlays + MapsPage (not 1 file).
- Extract `diceOverlayShared.ts` with FLY_OFFSETS/stableIndex/handshake.
- Remove the dead/unused fallback `Math.random()` draws in archerCombat (they don't run when MapsPage supplies values); only thread a single value if a real shown≠applied path is found.
- percentileNotation: NO change (documented-as-designed).

### Edge Cases
- Removing fields: tsc will flag readers (should be none).
- Single-RNG threading must not change the existing dice-box visual handshake.

### Complexity
M.

### Dependencies
None.

---

## T13 — 回合引擎 + 同步层回归测试  [P1 / M]

### Summary
Add the missing regression tests around the live turn engine, status mechanics, and sync merge logic — the safety net that must exist before the T15 MapsPage split.

### Context
Audit G2. Tests grew 1→8 files but cover the DEAD `combatAuthority` framework and helpers, NOT the live engine, sync/persistence merge, AP reset, or the player-action pipeline. The deadlock-class bugs had no regression net. This task builds that net over the LIVE behavior fixed in T1-T7/T10.

### Grounding Assets
- `src/lib/combatTokens.ts` (REFERENCE/requires — `pruneInitiativeForToken`, `isTokenAlive` — testable pure helpers)
- `src/store/characters.ts`/`maps.ts` (REFERENCE/requires — merge functions `mergePlayerWritableCharacter`, `mergePlayerTokenCombatFields` — pure, testable)
- The T1-T7/T10 changes (CONTRACT/binds — extracted pure helpers from those tasks are the unit-test surface)

### Acceptance Criteria
- [ ] AC0 (export precondition): `mergePlayerWritableCharacter` (characters.ts:~110) and `mergePlayerTokenCombatFields` (maps.ts:~22) are currently NOT exported — add `export` to them (a real, regression-checked code change) before they can be unit-tested. Likewise the pure helpers T1/T2/T3 committed to extract (`decideTurnAction`, `pruneRecovery`, `dotDamageFor`) must be exported from their modules.
- [ ] AC1: tests cover the T1 `decideTurnAction` non-actor skip (npc ⇒ 'skip'; all-npc queue does not infinite-loop via the dedupe key).
- [ ] AC2: tests cover T2 — `requestAdvance` reentrancy (two concurrent advances ⇒ one increment), `pruneRecovery` prune-to-0 (no deadlock), stale-round strike abort.
- [ ] AC3: tests cover T3 — `dotDamageFor` both branches (counter>0 ⇒ damage, ==0 ⇒ 0); stun skip decision.
- [ ] AC4: tests cover T4 — vulnerable damage multiplier both branches (via `applyAttackDefenseDamageModifier`, combatStats.ts:239); restrained movement lock predicate.
- [ ] AC5: tests cover T10 — HP sync (token.hp == currentHp after change), tombstone prevents resurrection, maps migrate from v0.
- [ ] AC6: tests cover sync merge — `mergePlayerWritableCharacter` keeps DM HP/AP and doesn't clobber non-whitelisted fields during combat; `mergePlayerTokenCombatFields` preserves DM token positions. (Depends on AC0 exports.)
- [ ] AC7: `npm test` green with the new tests; total count increases; the new tests exercise LIVE code (not the dead framework).

### Technical Approach
- The pure helpers are extracted **by T1/T2/T3 themselves** (each now carries an explicit "Extraction deliverable" — `decideTurnAction`, `pruneRecovery`/guard, `dotDamageFor`). T13 ADDS the `export`s for the two merge functions (AC0) and writes the tests. This closes the circular dependency the plan-review flagged: extraction is committed upstream, T13 only tests + exports.
- Add vitest files mirroring the existing `src/lib/*.test.ts` style.

### Edge Cases
- Tests must not depend on the dead framework.
- Adding `export` must not change behavior (pure re-export); verify with the existing 44 tests staying green.

### Complexity
L — broadened: real exports + comprehensive coverage across 6 subsystems; this is the safety net for T15.

### Dependencies
T1, T2, T3, T4, T10 — tests the behavior those tasks deliver and consumes their extracted helpers.

---

## T14 — 开 TypeScript strictNullChecks (分阶段 G1)  [P2 / L]

### Summary
Enable `strictNullChecks` (the highest-value strict sub-flag, the audit's named root cause) and clear the resulting null-handling errors; defer the rest of `strict`.

### Context
Audit G1 (the largest systemic risk). `tsconfig.app.json` has only noUnusedLocals/noUnusedParameters/erasableSyntaxOnly/noFallthroughCasesInSwitch — no strict/strictNullChecks/noImplicitAny. This is why the codebase is full of unguarded `?? fallback`. Per the user's decision: phase it — enable `strictNullChecks` FIRST, not full `strict`.

### Grounding Assets
- `tsconfig.app.json` (CONTRACT/binds — the compiler-options block 18-22)

### Acceptance Criteria
- [ ] AC1: `tsconfig.app.json` has `"strictNullChecks": true` (other `strict` sub-flags may stay off this round — documented).
- [ ] AC2: `npm run build` (tsc -b && vite build) is GREEN with strictNullChecks on — every surfaced null/undefined error is fixed with a real guard (not `!` non-null assertions sprinkled to silence; `as`/`!` used only where provably safe and commented).
- [ ] AC3 (no behavior change): fixes are null-handling only — no logic/behavior change; the 44+ tests (incl. T13's) stay green. Any place where a guard changes a runtime path documents the chosen default branch.
- [ ] AC4: a follow-up note records which remaining strict sub-flags (`noImplicitAny`, full `strict`) are deferred and why.
- [ ] AC5 (escape hatch): if the surfaced error count is unmanageable in one pass, it is acceptable to land with a DOCUMENTED, explicit allowlist of `// @ts-expect-error`/`!` at provably-safe sites (each with a one-line justification) rather than blocking the whole branch — but real guards are strongly preferred and the allowlist must be finite and listed. Watch interaction with the already-on `noUnusedLocals`/`verbatimModuleSyntax` (guards introducing unused temps / type-only import churn must not trip those).

### Technical Approach
- Flip `strictNullChecks`, run `tsc -b`, fix errors file-by-file (likely hundreds) with proper guards / optional chaining / explicit defaults matching existing behavior.
- Do this LAST among functional tasks so the surface is stable.

### Edge Cases
- A guard that changes a previously-`undefined`-tolerant path could alter behavior — prefer preserving the existing effective default; flag any ambiguous one.
- Generated/vendored files excluded as today.

### Complexity
L (bordering XL) — many mechanical fixes; scoped down from full strict by the strictNullChecks-first decision.

### Dependencies
Run after all functional tasks (T1-T13) so the code surface is stable; strongly benefits from T13's net.

---

## T15 — MapsPage god-object 拆分 (G3)  [P2 / L]

### Summary
Decompose `MapsPage.tsx` (6709 lines) into cohesive modules (turn engine, dice orchestration, sync polling, UI) behind the regression net from T13.

### Context
Audit G3. `MapsPage.tsx` grew 5518→6709 under the sync work and carries the turn engine, dice orchestration, sync polling, and UI simultaneously — the breeding ground for the A-cluster races. Per the user's decision: split AFTER T13's tests exist.

### Grounding Assets
- `src/pages/MapsPage.tsx` (CONTRACT/binds — the file to decompose)
- T13 tests (CONTRACT/binds — the behavior-preservation oracle for the split)

### Acceptance Criteria
- [ ] AC1: the turn engine (initiative/advance/enemy-turn timers/status tick), dice orchestration, and sync polling are extracted into separate modules/hooks (e.g. `useCombatEngine`, `useDiceOrchestration`, `useSharedSync`), with `MapsPage.tsx` materially smaller (target: well under 4000 lines; document the achieved count).
- [ ] AC2 (behavior-preserving): ALL T13 tests + the 44 baseline tests pass unchanged after the split — the extraction changes structure only, not behavior. `npm run build` green.
- [ ] AC3 (journey): full manual smoke (start combat, enemy turn, dodge, npc skip, DOT, end turn, map switch) behaves identically pre/post split on DM + player.
- [ ] AC4: the dead framework is still untouched (not wired in during the split).

### Technical Approach
- Extract the pure helpers seeded in T13 first, then lift the effects into custom hooks consuming refs/state passed in.
- Move in small behavior-preserving steps, running T13 tests after each.

### Edge Cases
- Effect dependency arrays must be preserved exactly when lifted into hooks.
- Refs shared across extracted hooks need careful ownership — pass via a shared object or context.

### Complexity
L — large mechanical refactor, de-risked by T13.

### Dependencies
T13 (the regression net is the precondition the user mandated). **GREENLIT ONLY IF** T13 actually delivered exported, passing coverage of the turn engine + status mechanics + sync merge (its AC0-AC7). If T13's coverage is thin, T15 is re-evaluated/parked rather than attempted blind against a 7021-line file — the split's only safety oracle is T13, so a weak T13 means T15 does not proceed.
