# HANDOFF — DNDSTARS override-upstream-gaps (resume T6→T15)

**For a fresh session.** Goal: finish overriding the remaining audit gaps. Half the plan is done & committed; this doc + `TASK_PLAN.md` are everything you need to continue.

## State

- **Repo**: `C:\Users\Shenghui Xu\Desktop\Gen_AI_Proj\06_15_regulus_dice_proj\DNDSTARS` (nested git repo).
- **Branch**: `override-upstream-gaps` (off upstream `origin/main` @ `3b17221` — the 34-commit DM-authority combat-sync work). Old branches `main`/`dice-threejs-rework` are backed up on the `fork` remote; our 3 dice commits were redundant with upstream and intentionally dropped.
- **Baseline gates**: `npx tsc -b` exits 0; `npm test` = 8 files / 44 tests green. Working tree is CLEAN at the T5 commit. Verify before starting: `git log --oneline -1` should show the progress-marker commit.
- **Full plan + per-task ACs (with plan-review corrections folded in)**: `TASK_PLAN.md`. Execution-progress checklist is at the top of that file.

## Done (committed, each build+test green, audit IDs traced)

| Task | Commit | Audit items |
|------|--------|-------------|
| T2 | `03955c1` | A6/A7/A8/A9/A10/A11/A12 — timer lifecycle + reentrancy (`requestAdvance` guard, map-switch/unmount timer cleanup, stale-round abort, death-key watchdog) |
| T1 | `8cb9ade` | A1/A2/BUG③ — NPC/obstacle DM-authoritative auto-skip (player-side deadlock gone) |
| T3 | `ff394a0` | C1/C2 — DOT damage per round (DM-only, `dotDamageFor` in `statusDamage.ts`) + stun skips turn |
| T4 | `fee64ad` | C3/C4/C5/C8 — vulnerable ×1.25 (`defenderVulnerable` param), restrained↔no-move unified movement lock, enemy status panel |
| T5 | `fe55fc6` | C6/C7/C9/C10 — single label source, 8-status registry, condition reconcile, distinct ignite emoji |

**Headline result so far**: the "卡两下卡死" (BUG②, with upstream's A3 dodge-timeout) and "NPC 进结算卡死" (BUG③) deadlocks are fixed, and the entire status-effect mechanics cluster (C1–C10) now actually runs rules.

## Remaining (do IN THIS ORDER — deps)

`T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14 → T15`

Each task's full spec (Summary/Context/Grounding/ACs/Approach/Edge/Complexity/Deps) is in `TASK_PLAN.md`. Short form:
- **T6** [P0/L] BUG① — structured monster attack schema `{toHit,damageDice,damageType,range,kind,save}` + populate all stat blocks + derived stats for every monster + unify HP source. **AC0 first**: `ENEMY_POOL` and `ENEMY_STAT_BLOCKS` membership diverge (~24-25, a superset) — establish the authoritative id list + parity test before authoring.
- **T7** [P1/M] (needs T6) — enemy AI rolls real attack dice (fix `buildEnemyAttack` label, NOT `inferEnemyDamageDiceCount` which is fine) + target npc/friendly + green wyrmling breath via `kind:'aoe'`+save + `DEFAULT_ENEMY_AC` (3 sites: enemyCombatStats/combatStats/AIPage — NOT EnemyDetailPanel's `??20` which is maxHp) + stale-poolId warn + text cleanup.
- **T8** [P1/M] — selection cleared on delete/death/map-switch (reset `fittedRef` on map.id change, NOT `key=` remount), occupancy/drag-threshold, hover race, tween cancel, keyboard move/delete. (D13 HP-bar-zoom is a NON-bug — dropped.)
- **T9** [P2/S] — delete `rageShot` dead code (both the `/* */` block AND any `if(false&&)`), blob-URL single-owner, animation throttle/pause, fix MapCanvas mojibake comments.
- **T10** [P1/M] — HP sync canonical (harden existing `syncTargetHp`, NOT a new reconciler), deletion tombstones, maps store version+migrate, enemy-AP restore. NOTE: enemy-AP is ALREADY in `SharedCombatState`+restored — verify, don't rebuild.
- **T11** [P2/L] — server hardening: cross-process write lock, OPT-IN auth (`STARS_SHARED_SECRET` unset ⇒ no change; preserve player-writable allowlist!), size/backlog caps, image GC, `safeName` collision + static-server-only `/api/*` 404, player monotonic guard.
- **T12** [P1/M] — delete `d20Geometry.ts` + write-only fields, coordinate dice timing constants cross-component, extract shared overlay module, remove dead fallback RNGs. **F5 percentile is documented-as-designed — DO NOT change it or its test.**
- **T13** [P1/L] (needs T1-T4,T10) — regression tests for the LIVE engine. **AC0**: `export` `mergePlayerWritableCharacter` (characters.ts) + `mergePlayerTokenCombatFields` (maps.ts) first. The pure helpers `decideTurnAction`/`pruneRecovery`/`dotDamageFor` extraction was committed to T1/T2/T3 — only `dotDamageFor` exists so far; T1/T2 left their logic inline, so either extract now or test via behavior.
- **T14** [P2/L] (last) — enable `strictNullChecks` ONLY (phased, not full strict), fix null errors with real guards; documented `!`/`@ts-expect-error` allowlist permitted if the count explodes.
- **T15** [P2/L] (needs T13) — split `MapsPage.tsx` (~7k lines). **GREENLIT ONLY IF** T13 delivered real passing coverage; else re-evaluate/park.

## Hard constraints (every task)

1. **KEEP the dead framework** — do NOT import/wire/delete `combatAuthority.ts`, `combatResolutionPipeline.ts`, `combatReactionHooks.ts`. Fix the LIVE `MapsPage.tsx` engine.
2. **Gate**: `npx tsc -b` exit 0 AND `npm test` green (≥44; may add, never break) before committing.
3. **DM-authority**: never add a player-side authoritative combat write; compute on DM + broadcast.
4. UTF-8 no BOM; comments in the file's language. File:line cites in the plan are ~250-300 lines stale — grep the SYMBOL.
5. Commit per task: `[Tn] <desc>` + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Update the progress checklist in `TASK_PLAN.md`.

## How to resume (serial subagent recipe — what's been working)

For each task in order: spawn ONE `task-executor` subagent (fresh context) with a prompt like:
> Implement TASK **Tn** from `TASK_PLAN.md` in `…/DNDSTARS` (branch override-upstream-gaps). Read TASK_PLAN.md Global Context + the `## Tn` section fully and implement its ACs. Hard constraints: keep the dead framework untouched; `npx tsc -b` + `npm test` must be green; no player-side authoritative writes; grep symbols (lines stale). Do NOT run git / do NOT commit. Report: files changed, exact tsc+test results, any AC you couldn't fully satisfy and why.

Then in the main session: run `npx tsc -b` + `npm test` yourself to confirm, and commit `[Tn] …`. Serial only — one task at a time (shared working tree). This conserves the orchestrator's context and isolates each task.

## Why not the workspace autorun

`scripts/autonomous_run.sh` watches the **root** repo's git HEAD for progress/hang-detection (AR-7/11/12/18), but our commits land in the **nested** `DNDSTARS/.git` — root HEAD wouldn't move, so autorun would misclassify success as "no progress" and false-retry/abort. It's also tasks.db-driven (our plan is in `TASK_PLAN.md`) and `claude -p` bills to the separate API pool, not the Max subscription. A fresh interactive session running the serial-subagent recipe above gets the same fresh-context benefit without the nested-repo mismatch.

## Carried-forward deferred items (honest, low-severity)

- **T4**: restrained does not yet grant attack (dis)advantage — movement-lock (the dominant promised effect) is done; advantage needs threading into the attack-roll path. Pick up inside a later pass.
- **T5 / C11**: `stableMind.ts` still uses a blocking `window.confirm`; replacing it with an async DM prompt touches the reaction flow. `calmMind.focusedSpiritOnHit` is already consumed (not a no-op).

## Out of scope (confirmed fixed upstream — do NOT redo)

A3, A5, E2, E3, E5, E12 — fixed by the 34 upstream combat-sync commits; we build on them.
