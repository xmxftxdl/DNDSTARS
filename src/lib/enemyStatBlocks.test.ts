import { describe, it, expect } from 'vitest'
import {
  ENEMY_STAT_BLOCKS,
  getPrimaryAttackAction,
  getEnemyStatBlock,
} from './enemyStatBlocks'
import { ENEMY_POOL } from './enemyPool'
import {
  getEnemyDerivedCombatStats,
  getEnemyMaxHp,
  enemyHasDerivedCombat,
} from './enemyCombatStats'
import { enemyTemplateToTokenPatch } from './enemyPool'

const STAT_BLOCK_IDS = Object.keys(ENEMY_STAT_BLOCKS)
const POOL_IDS = ENEMY_POOL.map((e) => e.id)

describe('[T6/AC0] ENEMY_POOL ↔ ENEMY_STAT_BLOCKS id parity', () => {
  // 权威 id 列表 = 两个集合（当前完全一致，共 25 个）。
  it('the authoritative monster count is 25', () => {
    expect(STAT_BLOCK_IDS.length).toBe(25)
    expect(POOL_IDS.length).toBe(25)
  })

  it('every pool id has a stat block and vice versa (bijection, no allowlist needed)', () => {
    const sortedPool = [...POOL_IDS].sort()
    const sortedBlocks = [...STAT_BLOCK_IDS].sort()
    expect(sortedBlocks).toEqual(sortedPool)
    // 显式列出差集，便于回归时一眼看到漂移。
    const blockOnly = STAT_BLOCK_IDS.filter((id) => !POOL_IDS.includes(id))
    const poolOnly = POOL_IDS.filter((id) => !STAT_BLOCK_IDS.includes(id))
    expect(blockOnly).toEqual([])
    expect(poolOnly).toEqual([])
  })
})

describe('[T6/AC2] every stat block has a structured primary attack', () => {
  it('每个 stat block 至少有一个含 damageDice 的动作', () => {
    for (const [id, block] of Object.entries(ENEMY_STAT_BLOCKS)) {
      const withDice = block.actions.filter((a) => !!a.damageDice)
      expect(withDice.length, `${id} 应至少有一个含 damageDice 的动作`).toBeGreaterThanOrEqual(1)
    }
  })

  it('getPrimaryAttackAction 对每个 stat block 返回带 damageDice/toHit 的动作', () => {
    for (const [id, block] of Object.entries(ENEMY_STAT_BLOCKS)) {
      const primary = getPrimaryAttackAction(block)
      expect(primary, `${id} 应有主攻击`).toBeDefined()
      expect(primary!.damageDice, `${id} 主攻击应有 damageDice`).toMatch(/^\d+d\d+(\+\d+)?$/)
      expect(typeof primary!.toHit, `${id} 主攻击应有 toHit`).toBe('number')
    }
  })

  it('goblin 弯刀 编码为 {toHit:4, damageDice:1d6+2, slashing, melee, range:5}', () => {
    const scimitar = ENEMY_STAT_BLOCKS.goblin.actions.find((a) => a.name === '弯刀')!
    expect(scimitar.toHit).toBe(4)
    expect(scimitar.damageDice).toBe('1d6+2')
    expect(scimitar.damageType).toBe('slashing')
    expect(scimitar.kind).toBe('melee')
    expect(scimitar.range).toBe(5)
  })
})

describe('[T6/AOE] 龙息编码为 kind:aoe + save（供 T7 消费）', () => {
  it('绿龙吐息 = 6d6 poison, DC11 con save, kind aoe', () => {
    const breath = ENEMY_STAT_BLOCKS['wyrmling-green'].actions.find((a) => a.kind === 'aoe')!
    expect(breath.damageDice).toBe('6d6')
    expect(breath.damageType).toBe('poison')
    expect(breath.save).toEqual({ ability: 'con', dc: 11 })
  })

  it('红龙吐息 = 4d6 fire, DC12 dex save, kind aoe', () => {
    const breath = ENEMY_STAT_BLOCKS['wyrmling-red'].actions.find((a) => a.kind === 'aoe')!
    expect(breath.damageDice).toBe('4d6')
    expect(breath.damageType).toBe('fire')
    expect(breath.save).toEqual({ ability: 'dex', dc: 12 })
  })
})

describe('[T6/AC3] every monster produces derived combat stats with to-hit + damage', () => {
  it('getEnemyDerivedCombatStats 对全部 25 怪都返回（不再硬性要求 equipment）', () => {
    for (const id of POOL_IDS) {
      const derived = getEnemyDerivedCombatStats(id)
      expect(derived, `${id} 应有派生战斗数值`).toBeDefined()
      expect(derived!.damageDice, `${id} 派生应含主攻击 damageDice`).toBeTruthy()
      expect(typeof derived!.toHit, `${id} 派生应含主攻击 toHit`).toBe('number')
      expect(derived!.maxHp).toBeGreaterThan(0)
    }
  })

  it('ogre/owlbear（无装备）也有 to-hit + damage', () => {
    for (const id of ['ogre', 'owlbear']) {
      const derived = getEnemyDerivedCombatStats(id)!
      expect(derived.equipment).toBeUndefined()
      expect(derived.toHit).toBe(getPrimaryAttackAction(getEnemyStatBlock(id)!)!.toHit)
      expect(derived.damageDice).toBe(getPrimaryAttackAction(getEnemyStatBlock(id)!)!.damageDice)
    }
  })
})

describe('[T6/AC4/B9/B10] single HP source of truth', () => {
  it('block.maxHp == template.maxHp for every monster (parity)', () => {
    for (const t of ENEMY_POOL) {
      const block = getEnemyStatBlock(t.id)!
      expect(block.maxHp, `${t.id} block.maxHp 应等于模板 maxHp`).toBe(t.maxHp)
    }
  })

  it('picker HP == spawned token maxHp for goblin+hobgoblin and 3 others', () => {
    for (const id of ['goblin', 'hobgoblin', 'ogre', 'owlbear', 'troll']) {
      const template = ENEMY_POOL.find((e) => e.id === id)!
      const pickerHp = template.maxHp // picker 渲染的就是 template.maxHp
      const patch = enemyTemplateToTokenPatch(template)
      expect(patch.maxHp, `${id} spawned token maxHp 应等于 picker HP`).toBe(pickerHp)
      // panel/derived 也读同一真相源
      expect(getEnemyMaxHp(id)).toBe(pickerHp)
      expect(getEnemyDerivedCombatStats(id)!.maxHp).toBe(pickerHp)
    }
  })
})

describe('[T6/AC5] goblin/hobgoblin equipment-derived behavior not regressed', () => {
  it('goblin+hobgoblin still use the equipment-derived path', () => {
    expect(enemyHasDerivedCombat('goblin')).toBe(true)
    expect(enemyHasDerivedCombat('hobgoblin')).toBe(true)
  })

  it('goblin+hobgoblin derived stats keep equipment + reconciled maxHp', () => {
    const goblin = getEnemyDerivedCombatStats('goblin')!
    expect(goblin.equipment).toBeDefined()
    expect(goblin.maxHp).toBe(12)
    const hob = getEnemyDerivedCombatStats('hobgoblin')!
    expect(hob.equipment).toBeDefined()
    expect(hob.maxHp).toBe(22)
  })
})
