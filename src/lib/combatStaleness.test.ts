import { describe, expect, it } from 'vitest'
import { resolveEnemyAttackTokens, shouldApplyDotTick } from './combatTokens'
import type { Token } from '../store/maps'
import type { Character } from '../types/character'

function token(patch: Partial<Token> & Pick<Token, 'id'>): Token {
  return {
    label: patch.id,
    x: 0,
    y: 0,
    color: '#fff',
    emoji: '',
    size: 1,
    type: 'enemy',
    ...patch,
  } as Token
}

function char(patch: Partial<Character> & Pick<Character, 'id' | 'currentHp'>): Character {
  return {
    name: patch.id,
    maxHp: 40,
    tempHp: 0,
    conditions: [],
    actionPoints: 2,
    currentAP: 2,
    ...patch,
  } as Character
}

// [T-P1-418/C4 · AC2] finishEnemyAttack 的目标解析是传入 token 列表的纯函数 —— 这正是
// live-vs-stale 的可测 oracle：用闭包旧快照 vs 用 getState 的 live 列表，解出的目标状态不同。
describe('T-P1-418/AC2 — resolveEnemyAttackTokens resolves against the map it is given', () => {
  const result = { attackerTokenId: 'goblin', targetTokenId: 'hero' }

  it('a STALE token snapshot resolves the pre-mutation target HP', () => {
    const stale = [token({ id: 'goblin' }), token({ id: 'hero', type: 'player', maxHp: 30, hp: 30 })]
    const { actorToken, targetToken } = resolveEnemyAttackTokens(stale, result)
    expect(actorToken?.id).toBe('goblin')
    expect(targetToken?.hp).toBe(30)
  })

  it('the LIVE token snapshot resolves the CURRENT (post-mutation) target HP', () => {
    // 棋面在攻击触发与 500ms dodge-poll 结算之间变了：hero 已被打到 5 血。
    const live = [token({ id: 'goblin' }), token({ id: 'hero', type: 'player', maxHp: 30, hp: 5 })]
    const { targetToken } = resolveEnemyAttackTokens(live, result)
    expect(targetToken?.hp).toBe(5) // 取当前棋面，而非进入函数时捕获的 30
  })

  it('returns undefined for ids absent from the given map (no spurious resolution)', () => {
    const { actorToken, targetToken } = resolveEnemyAttackTokens([], result)
    expect(actorToken).toBeUndefined()
    expect(targetToken).toBeUndefined()
  })
})

// [T-P1-418/C6-DOT · AC5·AC6] DOT tick 门控：存活才掉血；死亡单位跳过（不二次触发死亡处理）。
describe('T-P1-418/AC5·AC6 — shouldApplyDotTick gates DOT on liveness', () => {
  const noChars: Character[] = []

  it('AC6: an alive token with dot>0 takes the tick (death handling will run once)', () => {
    const alive = token({ id: 'e', type: 'enemy', maxHp: 10, hp: 10 })
    expect(shouldApplyDotTick(alive, noChars, 3)).toBe(true)
  })

  it('AC6: an alive token taking LETHAL dot still ticks exactly once (predicate true once per loop pass)', () => {
    const alive = token({ id: 'e', type: 'enemy', maxHp: 10, hp: 2 })
    expect(shouldApplyDotTick(alive, noChars, 99)).toBe(true)
  })

  it('AC5: a dead (0-HP) token with lingering DOT is SKIPPED (no re-fire of death handling)', () => {
    const dead = token({ id: 'e', type: 'enemy', maxHp: 10, hp: 0, burningTurns: 1 })
    expect(shouldApplyDotTick(dead, noChars, 3)).toBe(false)
  })

  it('dot of 0 never ticks even on a live token', () => {
    const alive = token({ id: 'e', type: 'enemy', maxHp: 10, hp: 10 })
    expect(shouldApplyDotTick(alive, noChars, 0)).toBe(false)
  })

  it('character-linked token: liveness follows the linked character currentHp', () => {
    const tok = token({ id: 't', type: 'player', characterId: 'c1' })
    expect(shouldApplyDotTick(tok, [char({ id: 'c1', currentHp: 8 })], 3)).toBe(true)
    expect(shouldApplyDotTick(tok, [char({ id: 'c1', currentHp: 0 })], 3)).toBe(false)
  })
})
