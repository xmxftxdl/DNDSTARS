# Verification boundary (what's automated vs manual-smoke)

[T-P1-422/AC5] The green baseline (`tsc -b` clean + `vitest run`) is real but **narrow**: vitest runs
`environment: node` (DOM-free) and exercises **extracted pure helpers** plus the server over real HTTP.
The stateful React core (MapsPage, dice overlays) is **not** in the automated net and is covered by
manual two-end smoke. This doc states exactly where the line is so a green CI is not mistaken for
full coverage.

## Required gate (CI — `.github/workflows/ci.yml`)

CI-safe only: **no** two/three-server stack, **no** local Qwen, **no** Playwright e2e.

| Step | Command | Gate |
|------|---------|------|
| Type-check | `npx tsc -b` | must be clean |
| Unit tests | `npx vitest run` | must be green (no external deps) |
| ESLint ratchet | `npm run lint:ratchet` | error count must not EXCEED `.eslint-ratchet.json` `maxErrors` (no-new-errors) |

The eslint gate is a **ratchet, not a clean bar**: the repo carries a known error backlog (mostly the
~7000-line `MapsPage.tsx` god object) being burned down task by task. A change that clears errors MUST
lower `maxErrors` in `.eslint-ratchet.json` in the same change (one-home ownership — see that file's
comment). History: 83 → 65 (T-P2-423) → 62 (T-P1-418).

## Automated (in the net)

| Subsystem | How verified |
|-----------|--------------|
| Combat token liveness / DOT gating / dodge / status-stacking | pure helpers in `src/lib/combatTokens.ts` (`isTokenAlive`, `shouldApplyDotTick`, `resolveDodgeOutcome`, `statusRefreshTokenPatch`, `resolveEnemyAttackTokens`) + `combatTokens.test.ts` / `combatStaleness.test.ts` |
| DOT per-round damage | `statusDamage.dotDamageFor` + `turnEngine.test.ts` |
| Combat authority mutation pass (the one live authority touchpoint) | `combatAuthority.executeCombatMutationsAuthority` + `combatAuthority.test.ts` (incl. refresh-to-max status) |
| Multi-end snapshot ordering / monotonic guard | `monotonicGuard.decideApply` + `monotonicGuard.test.ts`; characters merge in `syncMerge.test.ts` |
| Server write-path (lock fail-closed, heartbeat, atomic image, /api dispatch) | `shared-server-core.mjs` pure-fn + **real spawned static-server subprocess over HTTP** in `sharedServerCore.test.ts` / `sharedServerHttp.test.ts` |
| Client sync routing (base-list dedup, write double-send vs event single-canonical) | `sharedApi.test.ts` / `sharedApiEventTopology.test.ts` |
| Enemy AI structured attack / damage estimate | `enemyAi.test.ts` |

## Manual two-end smoke ONLY (NOT in the net)

Run with `npm run dev:dm` (5173) + `npm run dev:player1` (5174), or production `npm run build` then
`npm run serve:dm` / `npm run serve:player1`. Verify the journey end-state on BOTH ends matches.

| Subsystem | Why not automated | What to check manually |
|-----------|-------------------|------------------------|
| `MapsPage.tsx` combat effects / timers / live authority path | React state + setTimeout + closures; outside DOM-free vitest | start a fight, run an attack/AOE/enemy-turn, confirm HP/AP/status/log on both ends |
| DiceBox overlays — face-vs-value, iframe `postMessage` | sandboxed iframe + three.js render | roll a die, confirm the shown face equals the resolved value used for settlement |
| Multi-end sync drift (two-end settle) | needs two live clients + shared file root | T-P1-417 AC2: DM edits A.name while a Player saves combat from a pre-edit snapshot → both ends end with DM name + no lost field |
| MapsPage live-combat staleness (T-P1-418 AC2/AC4) | mid-combat map mutation + route remount | move a token mid enemy-turn (correct target HP); start fight, tab to /characters and back, confirm next broadcast applies |
| Production reconnect SSE topology (T-P1-421 AC2) | needs the two-server `start-local-servers.ps1` setup | reload a Player mid-session in serve mode, confirm missed trait-choice/dice/dodge replay |

## Local-soak only (EXCLUDED from the required gate)

- **Dice e2e** — documented ~38% tight-loop flakiness (flaky-by-design; see
  `docs/handoff/2026-06-16-dice-rework-handoff-5.md`). Run locally with `npm run e2e`; never block CI on it.
- **`e2e/ports.spec.ts`** — repointed to the playwright-managed dev servers (6173 DM / 6174 Player), so
  `npm run e2e` runs it **cold** (no manual PS1, no prebuilt `dist/`). Still kept OUT of required CI
  (Playwright browser install cost); run locally. The 5173/5174 production static-serve path is instead
  covered by the spawned-subprocess HTTP tests in `sharedServerHttp.test.ts`.

## Fresh-clone contract (T-P1-422/AC6)

`npm ci && npx tsc -b && npx vitest run` passes with **no** local server, Qwen, or other external
dependency. `npm run e2e` is optional/local (needs `npx playwright install`).
