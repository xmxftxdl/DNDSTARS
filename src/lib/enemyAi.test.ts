import { describe, it, expect, vi, afterEach } from 'vitest'
import { planEnemyTurn, clearEnemyAiWarnings } from './enemyAi'
import type { BattleMap, Token } from '../store/maps'

// 50px/格、无偏移：cell(c,r) 中心 = ((c+0.5)*50, (r+0.5)*50)，相邻格距离 = 1（近战触及）。
function makeMap(tokens: Token[]): BattleMap {
  return {
    id: 'm1',
    name: 'test',
    width: 1000,
    height: 1000,
    gridSize: 50,
    gridOffsetX: 0,
    gridOffsetY: 0,
    showGrid: true,
    tokens,
  }
}

function token(partial: Partial<Token> & Pick<Token, 'id' | 'type'>): Token {
  return {
    label: partial.id,
    x: 25,
    y: 25,
    color: '#fff',
    emoji: '🙂',
    size: 1,
    ...partial,
  } as Token
}

afterEach(() => {
  clearEnemyAiWarnings()
  vi.restoreAllMocks()
})

describe('[T7/AC1] buildEnemyAttack 按怪物真实结构化攻击数据投骰', () => {
  it('ogre / owlbear / goblin 近战攻击产出三种不同的 damageDice 标签', () => {
    const dice = ['ogre', 'owlbear', 'goblin'].map((poolId) => {
      // 敌人在 cell(0,0)，玩家在相邻 cell(1,0) → 近战触及。
      const enemy = token({ id: 'e', type: 'enemy', poolId, x: 25, y: 25 })
      const player = token({ id: 'p', type: 'player', x: 75, y: 25 })
      const result = planEnemyTurn(makeMap([enemy, player]), enemy, undefined, 2, { round: 2 })
      expect(result.attacked).toBe(true)
      const label = result.attack!.label
      const match = label.match(/(\d+d\d+)/)
      expect(match, `${poolId} 标签应含 XdY: ${label}`).toBeTruthy()
      return match![1]
    })
    // ogre=2d8、owlbear=1d10、goblin=1d6 → 三种各异。
    expect(new Set(dice).size).toBe(3)
    expect(dice).toContain('2d8')
    expect(dice).toContain('1d10')
    expect(dice).toContain('1d6')
  })

  // [T-P2-423/AC5] total/damage 不再是硬编码占位 1，而是按结构化骰估算（count*sides+bonus），
  // 与 attack.label/sides/bonus 自洽。
  it('近战 total/damage 反映真实估算伤害（非占位 1）', () => {
    const enemy = token({ id: 'e', type: 'enemy', poolId: 'ogre', x: 25, y: 25 })
    const player = token({ id: 'p', type: 'player', x: 75, y: 25 })
    const result = planEnemyTurn(makeMap([enemy, player]), enemy, undefined, 2, { round: 2 })
    expect(result.attacked).toBe(true)
    const attack = result.attack!
    const count = Number(attack.label.match(/(\d+)d\d+/)![1])
    const expected = count * attack.sides + attack.bonus
    expect(attack.total).toBe(expected)
    expect(result.damage).toBe(expected)
    expect(attack.total).toBeGreaterThan(1)
  })
})

describe('[T7/AC2] AI 目标集合包含 npc/友方', () => {
  it('有玩家在场时仍优先打玩家（回归锚点）', () => {
    const enemy = token({ id: 'e', type: 'enemy', poolId: 'goblin', x: 25, y: 25 })
    const player = token({ id: 'p', type: 'player', x: 75, y: 25 })
    const npc = token({ id: 'n', type: 'npc', x: 75, y: 25 })
    const result = planEnemyTurn(makeMap([enemy, player, npc]), enemy, undefined, 2, { round: 2 })
    expect(result.attacked).toBe(true)
    // 玩家与 npc 同格等距，nearest 取先出现者（player 先入列）→ 仍打玩家。
    expect(result.targetTokenId).toBe('p')
  })

  it('只有 npc 友方的遭遇：enemy 攻击 npc（不再 no-op）', () => {
    const enemy = token({ id: 'e', type: 'enemy', poolId: 'goblin', x: 25, y: 25 })
    const npc = token({ id: 'n', type: 'npc', x: 75, y: 25 })
    const result = planEnemyTurn(makeMap([enemy, npc]), enemy, undefined, 2, { round: 2 })
    expect(result.attacked).toBe(true)
    expect(result.targetTokenId).toBe('n')
  })

  it('只有其他 enemy / 障碍时无目标（不打自己人）', () => {
    const enemy = token({ id: 'e', type: 'enemy', poolId: 'goblin', x: 25, y: 25 })
    const ally = token({ id: 'e2', type: 'enemy', poolId: 'goblin', x: 75, y: 25 })
    const obstacle = token({ id: 'o', type: 'obstacle', x: 125, y: 25 })
    const result = planEnemyTurn(makeMap([enemy, ally, obstacle]), enemy, undefined, 2, { round: 2 })
    expect(result.attacked).toBe(false)
  })
})

describe('[T7/AC3] 红/绿龙吐息均由数据驱动（kind:aoe + save）', () => {
  it('绿龙第一回合从数据投出 6d6 毒气吐息（DC11）', () => {
    const enemy = token({ id: 'e', type: 'enemy', poolId: 'wyrmling-green', x: 25, y: 25 })
    const player = token({ id: 'p', type: 'player', x: 75, y: 25 })
    const result = planEnemyTurn(makeMap([enemy, player]), enemy, undefined, 2, { round: 1 })
    expect(result.damageType).toBe('aoe')
    expect(result.saveDC).toBe(11)
    expect(result.attack!.label).toContain('6d6')
    expect(result.attack!.sides).toBe(6)
  })

  it('红龙第一回合从数据投出 4d6 火焰吐息（DC12）', () => {
    const enemy = token({ id: 'e', type: 'enemy', poolId: 'wyrmling-red', x: 25, y: 25 })
    const player = token({ id: 'p', type: 'player', x: 75, y: 25 })
    const result = planEnemyTurn(makeMap([enemy, player]), enemy, undefined, 2, { round: 1 })
    expect(result.damageType).toBe('aoe')
    expect(result.saveDC).toBe(12)
    expect(result.attack!.label).toContain('4d6')
    expect(result.attack!.sides).toBe(6)
  })
})

describe('[T7/AC6] 陈旧/缺失 poolId 回退仅按 token id 告警一次', () => {
  it('同一无 poolId token 多回合只 warn 一次；清空后可再 warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const enemy = token({ id: 'e', type: 'enemy', x: 25, y: 25 }) // 无 poolId
    const player = token({ id: 'p', type: 'player', x: 75, y: 25 })
    const map = makeMap([enemy, player])
    planEnemyTurn(map, enemy, undefined, 2, { round: 2 })
    planEnemyTurn(map, enemy, undefined, 2, { round: 3 })
    expect(warn).toHaveBeenCalledTimes(1)
    clearEnemyAiWarnings()
    planEnemyTurn(map, enemy, undefined, 2, { round: 4 })
    expect(warn).toHaveBeenCalledTimes(2)
  })
})
