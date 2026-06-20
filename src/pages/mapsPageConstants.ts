// [T15/G3] MapsPage 标签/时序常量抽取。从 MapsPage.tsx 原样搬出——不改名、不改值、
// 不改时序契约。仅把模块级常量拆出独立边界，给 god-object 拆分让路。
import { advanceDelayMs, RESOLUTION_MS } from '../lib/diceOverlayShared'
import { TOKEN_MOVE_DURATION_S } from '../lib/gridCombat'
import {
  BURNING_STATUS_LABEL as CANON_BURNING_LABEL,
  POISON_STATUS_LABEL as CANON_POISON_LABEL,
  RESTRAINED_STATUS_LABEL as CANON_RESTRAINED_LABEL,
  VULNERABLE_STATUS_LABEL as CANON_VULNERABLE_LABEL,
  NO_MOVE_STATUS_LABEL as CANON_NO_MOVE_LABEL,
} from '../lib/tokenStatus'
import type { StatusType } from './mapsPageTypes'

// [T5/C6] alias the canonical labels from tokenStatus.ts (single source) — these consts
// keep their names so the ~20 reference sites are unchanged, but the literals live in one place.
export const STATUS_LABEL: Record<StatusType, string> = {
  burning: CANON_BURNING_LABEL,
  poison: CANON_POISON_LABEL,
}
export const RESTRAINED_STATUS_LABEL = CANON_RESTRAINED_LABEL
export const VULNERABLE_STATUS_LABEL = CANON_VULNERABLE_LABEL
export const NO_MOVE_STATUS_LABEL = CANON_NO_MOVE_LABEL

export const TOKEN_MOVE_MS = Math.ceil(TOKEN_MOVE_DURATION_S * 1000) + 80
export const DICE_ROLL_MS = 3200
// [T12/F2] ORDERING INVARIANT：结算（overlay 可见窗口 + 结果 HUD）必须先于回合推进。
// 推进延迟从共享时序契约 advanceDelayMs() 派生（= max(overlay 可见窗口, HUD) + ε），
// 由构造保证 ≥ 结算窗口 RESOLUTION_MS，而不是靠几个魔数恰好相等。原先用
// DICE_ROLL_MS+200=3400ms，反而 < HUD 自关闭 4000ms —— 推进会抢在结果卡定格之前。
export const ADVANCE_DELAY_MS = advanceDelayMs()
if (ADVANCE_DELAY_MS < RESOLUTION_MS) {
  // 不可达：advanceDelayMs() 由构造 = RESOLUTION_MS + ε ≥ RESOLUTION_MS。
  // 留作回归护栏——若有人改坏了契约常量，开发期立即炸出来。
  throw new Error(
    `[T12/F2] 时序契约被破坏：ADVANCE_DELAY_MS(${ADVANCE_DELAY_MS}) < RESOLUTION_MS(${RESOLUTION_MS})`,
  )
}
// [T2] reentrancy guard window: blocks a second initiative advance within this
// window of another (manual + timer, or two death-skip effects firing). Mirrors
// the previously-inline 350ms in advanceInitiative.
export const ADVANCE_GUARD_MS = 350
// [T2/A6] bounded fallback so a superseded death dice-overlay (no onDone) can't
// stall combat-end forever. Must be >= the longest dice overlay visible window.
export const DEATH_KEY_WATCHDOG_MS = 5000
