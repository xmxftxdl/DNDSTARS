import { describe, expect, it } from 'vitest'
import {
  clearPendingLocalCharacterCreationsForTest,
  mergeCharactersForSharedSave,
  mergePlayerWritableCharacter,
} from './characters'
import { mergePlayerTokenCombatFields, type BattleMap, type Token } from './maps'
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

describe('T13/AC6 鈥?mergePlayerWritableCharacter keeps DM-authoritative fields', () => {
  it('keeps DM HP/AP from the shared snapshot during combat (player local value discarded)', () => {
    // 鐜╁鏈湴鎶婅嚜宸辨不鍒版弧琛€銆丄P 鎷夋弧锛堣秺鏉冿級锛孌M 鏉冨▉蹇収璇翠粬琚墦鍒?12 琛€銆丄P 宸茶姳鍏夈€?
    const local = char({ currentHp: 40, maxHp: 40, actionPoints: 2, currentAP: 2 })
    const shared = char({ currentHp: 12, maxHp: 40, actionPoints: 0, currentAP: 0 })
    const merged = mergePlayerWritableCharacter(local, shared)
    // DM 鏉冨▉琛€閲?AP 鑳滃嚭锛堜笉琚帺瀹舵湰鍦拌鐩栵級
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

  it('does NOT clobber non-whitelisted local fields (only the whitelist comes from shared)', () => {
    // name 涓嶅湪鐧藉悕鍗?鈬?淇濈暀鏈湴鍊硷紝涓嶈瀵圭瑕嗙洊銆?
    const local = char({ name: '鐜╁鏀圭殑鍚嶅瓧', currentHp: 40 })
    const shared = char({ name: 'DM鏀圭殑鍚嶅瓧', currentHp: 12 })
    const merged = mergePlayerWritableCharacter(local, shared)
    expect(merged.name).toBe('鐜╁鏀圭殑鍚嶅瓧') // 闈炵櫧鍚嶅崟瀛楁淇濈暀鏈湴
    expect(merged.currentHp).toBe(12) // 鐧藉悕鍗曞瓧娈靛彇瀵圭
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
