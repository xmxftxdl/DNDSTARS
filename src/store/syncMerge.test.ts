import { describe, expect, it } from 'vitest'
import { mergePlayerWritableCharacter } from './characters'
import { mergePlayerTokenCombatFields, type BattleMap, type Token } from './maps'
import type { Character } from '../types/character'

// [T13/AC6] 同步合并回归：玩家端在合并对端（DM 权威）快照时，必须保留 DM 的血量/AP/token 位置，
// 且不覆盖非白名单字段。被测的是两个真实合并函数（AC0 刚加 export 的 LIVE 代码），不碰 dead 框架。
// 这正是「玩家不得越权写战斗权威态」的合并防线 —— DM-authority 的兜底。

function char(patch: Partial<Character>): Character {
  return {
    id: 'hero',
    name: '英雄',
    currentHp: 30,
    maxHp: 40,
    tempHp: 0,
    conditions: [],
    actionPoints: 2,
    currentAP: 2,
    ...patch,
  } as Character
}

function token(patch: Partial<Token>): Token {
  return {
    id: 'tok',
    label: 'Tok',
    x: 0,
    y: 0,
    color: '#fff',
    emoji: '',
    size: 1,
    type: 'enemy',
    ...patch,
  }
}

function map(patch: Partial<BattleMap>): BattleMap {
  return {
    id: 'map1',
    name: '地图',
    width: 800,
    height: 600,
    gridSize: 50,
    gridOffsetX: 0,
    gridOffsetY: 0,
    showGrid: true,
    tokens: [],
    ...patch,
  }
}

describe('T13/AC6 — mergePlayerWritableCharacter keeps DM-authoritative fields', () => {
  it('keeps DM HP/AP from the shared snapshot during combat (player local value discarded)', () => {
    // 玩家本地把自己治到满血、AP 拉满（越权），DM 权威快照说他被打到 12 血、AP 已花光。
    const local = char({ currentHp: 40, maxHp: 40, actionPoints: 2, currentAP: 2 })
    const shared = char({ currentHp: 12, maxHp: 40, actionPoints: 0, currentAP: 0 })
    const merged = mergePlayerWritableCharacter(local, shared)
    // DM 权威血量/AP 胜出（不被玩家本地覆盖）
    expect(merged.currentHp).toBe(12)
    expect(merged.actionPoints).toBe(0)
    expect(merged.currentAP).toBe(0)
    expect(merged.tempHp).toBe(shared.tempHp)
    expect(merged.conditions).toBe(shared.conditions)
  })

  it('does NOT clobber non-whitelisted local fields (only the whitelist comes from shared)', () => {
    // name 不在白名单 ⇒ 保留本地值，不被对端覆盖。
    const local = char({ name: '玩家改的名字', currentHp: 40 })
    const shared = char({ name: 'DM改的名字', currentHp: 12 })
    const merged = mergePlayerWritableCharacter(local, shared)
    expect(merged.name).toBe('玩家改的名字') // 非白名单字段保留本地
    expect(merged.currentHp).toBe(12) // 白名单字段取对端
  })
})

describe('T13/AC6 — mergePlayerTokenCombatFields preserves DM token positions', () => {
  it('a non-player (enemy) token takes DM x/y from shared (player cannot move it)', () => {
    const localMap = map({ tokens: [token({ id: 'e1', type: 'enemy', x: 100, y: 100, hp: 5, maxHp: 10 })] })
    const sharedMap = map({ tokens: [token({ id: 'e1', type: 'enemy', x: 500, y: 700, hp: 3, maxHp: 10 })] })
    const [result] = mergePlayerTokenCombatFields([localMap], [sharedMap])
    const e1 = result.tokens.find((t) => t.id === 'e1')!
    // DM 权威位置覆盖玩家本地位置
    expect(e1.x).toBe(500)
    expect(e1.y).toBe(700)
    // 战斗字段同样取 DM 权威值
    expect(e1.hp).toBe(3)
  })

  it("a player-type token keeps its OWN local x/y (DM does not move the player's own token)", () => {
    const localMap = map({ tokens: [token({ id: 'p1', type: 'player', x: 120, y: 130, hp: 20, maxHp: 30 })] })
    const sharedMap = map({ tokens: [token({ id: 'p1', type: 'player', x: 999, y: 888, hp: 15, maxHp: 30 })] })
    const [result] = mergePlayerTokenCombatFields([localMap], [sharedMap])
    const p1 = result.tokens.find((t) => t.id === 'p1')!
    // 玩家自己 token 的位置保留本地（dmControlledPosition 仅对非 player 生效）
    expect(p1.x).toBe(120)
    expect(p1.y).toBe(130)
    // 但战斗字段（hp 等）仍取 DM 权威值
    expect(p1.hp).toBe(15)
  })

  it('a token absent from the shared snapshot is left untouched (no spurious overwrite)', () => {
    const localMap = map({ tokens: [token({ id: 'only-local', type: 'enemy', x: 50, y: 60, hp: 9, maxHp: 9 })] })
    const sharedMap = map({ tokens: [] })
    const [result] = mergePlayerTokenCombatFields([localMap], [sharedMap])
    const t = result.tokens.find((x) => x.id === 'only-local')!
    expect(t.x).toBe(50)
    expect(t.y).toBe(60)
    expect(t.hp).toBe(9)
  })
})
