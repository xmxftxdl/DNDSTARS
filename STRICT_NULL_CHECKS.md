# TypeScript strict — phased rollout (T14 / audit G1)

## This round: `strictNullChecks` ONLY

`tsconfig.app.json` now enables `"strictNullChecks": true` and nothing else from
the `strict` family. This is the audit's named root cause (G1) and the
highest-value strict sub-flag, so it is flipped first and in isolation.

### Surfaced error count

After flipping `strictNullChecks: true` and running `tsc -p tsconfig.app.json`
(and `tsc -b --force`), the surfaced null/undefined error count was **0**.

The codebase — which had grown under the T1–T13 work — already guards its
null/undefined paths (optional chaining, `?? fallback`, explicit narrowing)
defensively enough that `strictNullChecks` finds nothing to fix. The flag was
verified to be genuinely active by a deliberate `string | null → string`
assignment probe, which correctly errored with `TS2322` (probe removed after the
check). So the green result is real, not a config that silently no-ops.

Because the surfaced count was 0, **no source files were touched, no guards were
added, and there are zero `!` / `@ts-expect-error` escape-hatch sites** (the
AC5 allowlist is empty). Behavior is therefore unchanged by construction —
nothing in `src/` was edited.

## Deferred strict sub-flags (NOT enabled this round) — AC4

The following are intentionally left OFF and folded into a future full-`strict`
flip, once `strictNullChecks` has lived in `main` long enough to be considered
stable:

| Flag | Status | Why deferred |
|------|--------|--------------|
| `strict` (umbrella) | OFF | Would enable every sub-flag below at once; defeats the phasing the user mandated. |
| `noImplicitAny` | OFF | The codebase has many implicit-`any` params/locals; annotating them is a separate, larger mechanical pass with its own behavior-review surface. Not a null-handling concern. |
| `strictFunctionTypes` | OFF | Bivariance tightening; unrelated to G1's null root cause; folded into the future full-strict flip. |
| `strictBindCallApply` | OFF | Same — folded into the future full-strict flip. |
| `strictPropertyInitialization` | OFF | Requires `strictNullChecks` (now on) but mainly affects class fields; the app is overwhelmingly hooks/functions, low value this round. |
| `alwaysStrict` | OFF | Emit-level `"use strict"`; cosmetic for an ESM/bundler build; deferred. |
| `useUnknownInCatchVariables` | OFF | Would force `catch (e: unknown)` narrowing across the codebase; separate cleanup. |

Recommended next step (separate task): flip `noImplicitAny` and clear its
surface; then the full `strict` umbrella once both have stabilized.
