import { describe, expect, it } from 'vitest'
import {
  clearPendingLocalCharacterCreationsForTest,
  mergeCharactersForSharedSave,
  mergePlayerWritableCharacter,
} from './characters'
import { mergePlayerTokenCombatFields, type BattleMap, type Token } from './maps'
import { decideApply, type MonotonicState } from '../lib/monotonicGuard'
import type { Character } from '../types/character'

// [T13/AC6] 鍚屾鍚堝苟鍥炲綊锛氱帺瀹剁鍦ㄥ悎骞跺绔紙DM 鏉冨▉锛夊揩鐓ф椂锛屽繀椤讳繚鐣?DM 鐨勮閲?AP/token 浣嶇疆锛?
// 涓斾笉瑕嗙洊闈炵櫧鍚嶅崟瀛楁銆傝娴嬬殑鏄袱涓湡瀹炲悎骞跺嚱鏁帮紙AC0 鍒氬姞 export 鐨?LIVE 浠ｇ爜锛夛紝涓嶇 dead 妗嗘灦銆?
// 杩欐鏄€岀帺瀹朵笉寰楄秺鏉冨啓鎴樻枟鏉冨▉鎬併€嶇殑鍚堝苟闃茬嚎 鈥斺€?DM-authority 鐨勫厹搴曘€?

function char(patch: Partial<Character>): Character {
  return {
    id: 'hero',
    name: '鑻遍泟',
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
    name: '鍦板浘',
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

describe('T-P1-417/AC3 — mergePlayerWritableCharacter 全量采用 DM shared（Option B，DM-authority）', () => {
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

  it('keeps DM combat buffs, qi, cooldowns and feature uses from the shared snapshot', () => {
    const local = char({
      qi: 0,
      combatBuffs: {},
      traits: [
        {
          id: 'gale-local',
          name: 'Gale Combo',
          level: 1,
          uses: 1,
          maxUses: 1,
          description: '',
          featureKey: 'galeCombo',
        },
      ],
      combatSkills: [
        {
          id: 'basic-shot',
          name: 'Basic Shot',
          emoji: 'bow',
          description: '',
          apCost: 1,
          cooldown: 0,
          cdReduction: 0,
          remaining: 0,
          usedThisTurn: false,
          damageCount: 1,
          damageSides: 8,
          damageBonus: 0,
          skillTreeId: 'basicShot',
        },
      ],
    })
    const shared = char({
      qi: 7,
      combatBuffs: { galeComboReady: true },
      traits: [
        {
          id: 'gale-shared',
          name: 'Gale Combo',
          level: 1,
          uses: 0,
          maxUses: 1,
          description: '',
          featureKey: 'galeCombo',
        },
      ],
      combatSkills: [
        {
          id: 'basic-shot',
          name: 'Basic Shot',
          emoji: 'bow',
          description: '',
          apCost: 1,
          cooldown: 0,
          cdReduction: 0,
          remaining: 2,
          usedThisTurn: true,
          damageCount: 1,
          damageSides: 8,
          damageBonus: 0,
          skillTreeId: 'basicShot',
        },
      ],
    })

    const merged = mergePlayerWritableCharacter(local, shared)

    expect(merged.qi).toBe(7)
    expect(merged.combatBuffs?.galeComboReady).toBe(true)
    expect(merged.traits[0].uses).toBe(0)
    expect(merged.traits[0].maxUses).toBe(1)
    expect(merged.combatSkills[0]).toMatchObject({ remaining: 2, usedThisTurn: true })
  })

  it('AC3 both directions: a DM-only field (name) AND a combat field both take the shared (DM) value', () => {
    // [T-P1-417 · C6 fix] 此前 base=...local 会让玩家旧快照里的 name 冲掉 DM 改过的 name（DM 编辑丢失）。
    // Option B 修复后：非白名单的 name 与白名单的战斗字段都取 shared —— 玩家无法在任一方向越权覆盖 DM。
    const local = char({ name: '玩家旧快照里的名字', currentHp: 40, qi: 9 })
    const shared = char({ name: 'DM 刚改的新名字', currentHp: 12, qi: 3 })
    const merged = mergePlayerWritableCharacter(local, shared)
    expect(merged.name).toBe('DM 刚改的新名字') // 非白名单字段不再保留本地，DM 权威胜出
    expect(merged.currentHp).toBe(12) // 战斗字段仍取 DM
    expect(merged.qi).toBe(3)
  })
})

describe('T-P1-417/AC6 — 单调时钟 + 交错写：两端编辑都不丢失', () => {
  // 复现 C1：DM 在 t 编辑 A.name，玩家从「t 之前的快照」并发保存。saveCharacters 写盘前会
  // loadSharedResource 拿到最新 shared 再 merge，故玩家写出的 payload 必然带 DM 的新 name（不丢）。
  it('player save built from a pre-DM snapshot still carries the DM name edit (no DM loss)', () => {
    const playerLocalStale = char({ id: 'A', name: '旧名字', currentHp: 40 })
    const freshSharedAfterDmEdit = char({ id: 'A', name: 'DM 新名字', currentHp: 30 })
    // 玩家写盘前对最新 shared 做 merge：
    const whatPlayerWrites = mergePlayerWritableCharacter(playerLocalStale, freshSharedAfterDmEdit)
    expect(whatPlayerWrites.name).toBe('DM 新名字')
    expect(whatPlayerWrites.currentHp).toBe(30)
  })

  // 服务器 freshness guard 会拒绝 updatedAt < existing；两端统一走 decideApply：
  // 严格更旧的乱序快照被丢弃，较新的被应用 —— 玩家端不再裸接受乱序写而回退。
  it('decideApply: a stale out-of-order snapshot is rejected; a newer one is applied (symmetric guard)', () => {
    const state: MonotonicState = { lastUpdatedAt: 0, lastSnapshot: '' }
    const applyNewer = decideApply(state, 101, JSON.stringify({ name: 'DM 新名字' }))
    expect(applyNewer.apply).toBe(true)
    // 一个基于旧快照、updatedAt 更旧的乱序写到达：必须丢弃，不能回退已应用的较新状态。
    const rejectStale = decideApply(applyNewer.next, 100, JSON.stringify({ name: '玩家旧名字' }))
    expect(rejectStale.apply).toBe(false)
    expect(rejectStale.reason).toBe('stale')
    expect(rejectStale.next.lastSnapshot).toContain('DM 新名字')
  })
})

describe('character shared-save merge preserves cross-end creations', () => {
  it('keeps shared-only characters when a stale DM snapshot writes later', () => {
    const dmLocal = [char({ id: 'dm-known', name: 'DM already loaded' })]
    const shared = [
      char({ id: 'dm-known', name: 'DM already loaded' }),
      char({ id: 'player-new', name: 'Player created' }),
    ]

    const merged = mergeCharactersForSharedSave(dmLocal, shared, { playerPort: false })
    expect(merged.map((item) => item.id)).toEqual(['dm-known', 'player-new'])
  })

  it('does not let a player stale local-only sample overwrite shared characters', () => {
    clearPendingLocalCharacterCreationsForTest()
    const playerLocal = [
      char({ id: 'sample-local', name: 'Local sample' }),
      char({ id: 'shared-hero', name: 'Edited locally' }),
    ]
    const shared = [char({ id: 'shared-hero', name: 'Shared hero' })]

    const merged = mergeCharactersForSharedSave(playerLocal, shared, { playerPort: true })
    expect(merged.map((item) => item.id)).toEqual(['shared-hero'])
    expect(merged[0].name).toBe('Edited locally')
  })
})

describe('T13/AC6 mergePlayerTokenCombatFields preserves DM token positions', () => {
  it('a non-player (enemy) token takes DM x/y from shared (player cannot move it)', () => {
    const localMap = map({ tokens: [token({ id: 'e1', type: 'enemy', x: 100, y: 100, hp: 5, maxHp: 10 })] })
    const sharedMap = map({
      tokens: [token({ id: 'e1', type: 'enemy', x: 500, y: 700, hp: 3, maxHp: 10, illusionDanceTurns: 1 })],
    })
    const [result] = mergePlayerTokenCombatFields([localMap], [sharedMap])
    const e1 = result.tokens.find((t) => t.id === 'e1')!
    // DM 鏉冨▉浣嶇疆瑕嗙洊鐜╁鏈湴浣嶇疆
    expect(e1.x).toBe(500)
    expect(e1.y).toBe(700)
    // 鎴樻枟瀛楁鍚屾牱鍙?DM 鏉冨▉鍊?
    expect(e1.hp).toBe(3)
    expect(e1.illusionDanceTurns).toBe(1)
  })

  it("a player-type token keeps its OWN local x/y (DM does not move the player's own token)", () => {
    const localMap = map({ tokens: [token({ id: 'p1', type: 'player', x: 120, y: 130, hp: 20, maxHp: 30 })] })
    const sharedMap = map({ tokens: [token({ id: 'p1', type: 'player', x: 999, y: 888, hp: 15, maxHp: 30 })] })
    const [result] = mergePlayerTokenCombatFields([localMap], [sharedMap])
    const p1 = result.tokens.find((t) => t.id === 'p1')!
    // 鐜╁鑷繁 token 鐨勪綅缃繚鐣欐湰鍦帮紙dmControlledPosition 浠呭闈?player 鐢熸晥锛?
    expect(p1.x).toBe(120)
    expect(p1.y).toBe(130)
    // 浣嗘垬鏂楀瓧娈碉紙hp 绛夛級浠嶅彇 DM 鏉冨▉鍊?
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
