import { describe, expect, it } from 'vitest'
import type { Token } from '../store/maps'
import type { Character } from '../types/character'
import { checkCombatOutcome, isTokenAlive, resolveDodgeOutcome, statusRefreshTokenPatch } from './combatTokens'

function token(patch: Partial<Token>): Token {
  return {
    id: 'token',
    label: 'Token',
    x: 0,
    y: 0,
    color: '#fff',
    emoji: '',
    size: 1,
    type: 'player',
    ...patch,
  }
}

describe('combat token liveness', () => {
  it('does not treat a linked token as defeated while its character is still syncing', () => {
    const linkedPlayer = token({ id: 'player-token', type: 'player', characterId: 'missing-character' })
    const enemy = token({ id: 'enemy-token', type: 'enemy', hp: 12, maxHp: 12 })

    expect(isTokenAlive(linkedPlayer, [])).toBe(true)
    expect(checkCombatOutcome([linkedPlayer, enemy], [])).toEqual({ ended: false })
  })

  it('still treats a linked token as defeated when the synced character is at 0 HP', () => {
    const linkedPlayer = token({ id: 'player-token', type: 'player', characterId: 'hero' })
    const enemy = token({ id: 'enemy-token', type: 'enemy', hp: 12, maxHp: 12 })
    const hero = { id: 'hero', currentHp: 0 } as Character

    expect(isTokenAlive(linkedPlayer, [hero])).toBe(false)
    expect(checkCombatOutcome([linkedPlayer, enemy], [hero]).ended).toBe(true)
  })
})

// [T-P1-420/AC2] re-homed from the deleted resolveDodgeAuthority — the live MapsPage enemy-dodge
// path (:2427-2428) now resolves through this single pure function.
describe('T-P1-420/AC2 — resolveDodgeOutcome (re-homed dodge rule)', () => {
  it('a successful dodge takes no damage and spends the attempt (total < AC)', () => {
    const r = resolveDodgeOutcome(8, 5, 14, 10)
    expect(r).toEqual({ total: 13, dodged: true, damageApplied: 0 })
  })

  it('a failed dodge applies the damage (total >= AC)', () => {
    const r = resolveDodgeOutcome(9, 5, 14, 10)
    expect(r).toEqual({ total: 14, dodged: false, damageApplied: 10 })
  })
})

// [T-P1-420/AC3] the single canonical status-stacking rule = refresh-to-max.
describe('T-P1-420/AC3 — statusRefreshTokenPatch (single refresh-to-max rule)', () => {
  it('re-applying a shorter duration keeps the longer remaining (max), never overwrites down', () => {
    const t = token({ id: 'e', type: 'enemy', burningTurns: 3 })
    expect(statusRefreshTokenPatch(t, '燃烧', 1)).toEqual({ burningTurns: 3 })
  })

  it('a longer duration extends to the new value', () => {
    const t = token({ id: 'e', type: 'enemy', burningTurns: 2 })
    expect(statusRefreshTokenPatch(t, '燃烧', 5)).toEqual({ burningTurns: 5 })
  })

  it('maps each condition label to its own status field; unknown/zero turns produce no patch', () => {
    const t = token({ id: 'e', type: 'enemy' })
    expect(statusRefreshTokenPatch(t, '中毒', 2)).toEqual({ poisonTurns: 2 })
    expect(statusRefreshTokenPatch(t, '燃烧', 0)).toEqual({})
    expect(statusRefreshTokenPatch(t, 'unknown-status', 3)).toEqual({})
  })
})
