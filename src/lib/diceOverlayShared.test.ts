import { describe, expect, it } from 'vitest'
import {
  DICE_TIMING,
  FLY_OFFSETS,
  RESOLUTION_MS,
  advanceDelayMs,
  resolveFlyOffset,
  stableIndex,
} from './diceOverlayShared'

describe('diceOverlayShared timing contract (T12/F2)', () => {
  it('RESOLUTION_MS is the max of overlay windows and HUD', () => {
    expect(RESOLUTION_MS).toBe(
      Math.max(
        DICE_TIMING.ROLL_MIN_VISIBLE_MS,
        DICE_TIMING.D20_MIN_VISIBLE_MS,
        DICE_TIMING.HUD_MS,
      ),
    )
  })

  it('ORDERING INVARIANT: advance delay >= resolution delay by construction', () => {
    // The whole point of F2: resolution precedes advance, not by coincidence.
    expect(advanceDelayMs()).toBeGreaterThanOrEqual(RESOLUTION_MS)
    expect(advanceDelayMs()).toBe(RESOLUTION_MS + DICE_TIMING.ADVANCE_EPSILON_MS)
  })

  it('advance delay also clears the HUD self-close window', () => {
    // Pre-T12 advance (DICE_ROLL_MS+200=3400) was < HUD 4000 — the latent gap.
    expect(advanceDelayMs()).toBeGreaterThanOrEqual(DICE_TIMING.HUD_MS)
  })
})

describe('diceOverlayShared fly-offset / stableIndex (T12/F3)', () => {
  it('stableIndex is deterministic and in-range', () => {
    const a = stableIndex('seed-x', FLY_OFFSETS.length)
    const b = stableIndex('seed-x', FLY_OFFSETS.length)
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(FLY_OFFSETS.length)
  })

  it('resolveFlyOffset honors explicit flyIndex (mod-normalized)', () => {
    expect(resolveFlyOffset('any', 2)).toBe(FLY_OFFSETS[2])
    expect(resolveFlyOffset('any', FLY_OFFSETS.length + 3)).toBe(FLY_OFFSETS[3])
  })

  it('resolveFlyOffset falls back to stable hash when flyIndex absent', () => {
    expect(resolveFlyOffset('reqId-42')).toBe(
      FLY_OFFSETS[stableIndex('reqId-42', FLY_OFFSETS.length)],
    )
  })
})
