import type { Token } from '../store/maps'
import type { CharacterEquipment } from '../types/equipment'
import {
  applyAttackDefenseDamageModifier,
  computeAc,
  DEFAULT_ENEMY_AC,
  type AttackDefenseDamageAdjust,
  type CombatStatInput,
  type DamageReductionType,
  computeCritDamageMultiplier,
  computeDefense,
  computeMagicAttack,
  computeMagicDefense,
  computeMaxHp,
  computePhysicalAttack,
  formatCritDamagePercentFromInput,
  formatEquipmentStatLine,
  hasAnyEquipment,
} from './combatStats'
import { EQUIPMENT_SLOT_LABELS, EQUIPMENT_SLOTS } from './equipmentDefaults'
import { getEnemyStatBlock, getPrimaryAttackAction, type EnemyStatBlock } from './enemyStatBlocks'

export function enemyHasDerivedCombat(poolId?: string): boolean {
  if (!poolId) return false
  const block = getEnemyStatBlock(poolId)
  return !!block?.equipment && hasAnyEquipment(block.equipment)
}

export function enemyCombatInput(poolId: string): CombatStatInput | undefined {
  const block = getEnemyStatBlock(poolId)
  if (!block?.equipment || !hasAnyEquipment(block.equipment)) return undefined
  return {
    abilities: block.abilities,
    equipment: block.equipment,
    acFallback: block.ac,
  }
}

export function getEnemyAc(poolId: string): number {
  const input = enemyCombatInput(poolId)
  return input ? computeAc(input) : (getEnemyStatBlock(poolId)?.ac ?? DEFAULT_ENEMY_AC)
}

/**
 * [T6/B9/B10] HP 真相源统一：所有怪物的最大生命值都来自 stat block 的 `maxHp`
 * 字段（与 ENEMY_POOL 模板一致，由 parity 测试守护）。装备派生路径（goblin/hobgoblin）
 * 当前其 computeMaxHp 结果已与模板一致；为保持单一真相源，统一读取 block.maxHp，
 * 仅在无 stat block 时回退到 fallback。
 */
export function getEnemyMaxHp(poolId: string, fallback = 12): number {
  const block = getEnemyStatBlock(poolId)
  if (block) return block.maxHp
  return fallback
}

export function getTokenTargetAc(token: Token): number | undefined {
  if (token.poolId && enemyHasDerivedCombat(token.poolId)) {
    return getEnemyAc(token.poolId)
  }
  return undefined
}

export function adjustDamageAgainstToken(
  baseDamage: number,
  attacker: CombatStatInput | undefined,
  token: Token,
  type: DamageReductionType = 'physical',
): AttackDefenseDamageAdjust {
  // [T4/C3] vulnerable applies even when there's no poolId/defender (e.g. plain tokens),
  // so route every branch through applyAttackDefenseDamageModifier with the flag.
  const vulnerable = (token.vulnerableTurns ?? 0) > 0
  const defender = token.poolId ? enemyCombatInput(token.poolId) : undefined
  return applyAttackDefenseDamageModifier(baseDamage, attacker, defender, type, vulnerable)
}

export interface EnemyDerivedCombatStats {
  ac: number
  physicalAttack: number
  defense: number
  magicAttack: number
  magicDefense: number
  maxHp: number
  critDamagePercent: string
  /** [T6/B1] 主攻击命中加值（来自 stat block 结构化动作；无则 undefined） */
  toHit?: number
  /** [T6/B1] 主攻击伤害骰（如 '1d6+2'；无则 undefined） */
  damageDice?: string
  /** [T6/B1] 主攻击伤害类型 */
  damageType?: string
  /** [T6/B1] 主攻击名称（用于面板展示） */
  attackName?: string
  /** 装备派生路径（goblin/hobgoblin）才有；其余怪物从属性派生时为 undefined */
  equipment?: CharacterEquipment
}

/**
 * [T6/B1] 派生战斗数值。
 * - 装备路径（goblin/hobgoblin）：沿用原装备公式（AC5 不回归）。
 * - 无装备路径（其余怪物）：从 abilities + stat block 的 `maxHp`/`ac` + 主攻击派生，
 *   不再因缺少 equipment 而返回 undefined（AC3）。
 * 任一路径都附带主攻击的 toHit/damageDice/damageType，供面板渲染命中+伤害。
 */
export function getEnemyDerivedCombatStats(poolId: string): EnemyDerivedCombatStats | undefined {
  const block = getEnemyStatBlock(poolId)
  if (!block) return undefined
  const primary = getPrimaryAttackAction(block)
  const attackFields = {
    toHit: primary?.toHit,
    damageDice: primary?.damageDice,
    damageType: primary?.damageType,
    attackName: primary?.name,
  }

  const equipInput = enemyCombatInput(poolId)
  if (equipInput?.equipment) {
    // 装备派生路径：与原实现逐字节一致（AC5 回归锚点）。
    return {
      ac: computeAc(equipInput),
      physicalAttack: computePhysicalAttack(equipInput),
      defense: Math.round(computeDefense(equipInput)),
      magicAttack: computeMagicAttack(equipInput),
      magicDefense: Math.round(computeMagicDefense(equipInput)),
      maxHp: computeMaxHp(equipInput),
      critDamagePercent: formatCritDamagePercentFromInput(equipInput),
      equipment: equipInput.equipment,
      ...attackFields,
    }
  }

  // 无装备路径：从属性派生（equipment 缺省 → 装备加成为 0）。
  const input: CombatStatInput = { abilities: block.abilities, acFallback: block.ac }
  return {
    ac: computeAc(input), // 无装备 → 回退 stat block AC
    physicalAttack: computePhysicalAttack(input),
    defense: Math.round(computeDefense(input)),
    magicAttack: computeMagicAttack(input),
    magicDefense: Math.round(computeMagicDefense(input)),
    maxHp: block.maxHp, // HP 真相源（B9/B10）
    critDamagePercent: formatCritDamagePercentFromInput(input),
    ...attackFields,
  }
}

export function formatEnemyEquipmentList(equipment: CharacterEquipment): string {
  return EQUIPMENT_SLOTS.map((slot) => equipment[slot]?.name)
    .filter(Boolean)
    .join(' · ')
}

export function getEnemyEquipmentSlots(poolId: string): { slot: string; label: string; name?: string; stats: string }[] {
  const block = getEnemyStatBlock(poolId)
  if (!block?.equipment) return []
  return EQUIPMENT_SLOTS.map((slot) => {
    const item = block.equipment![slot]
    return {
      slot,
      label: EQUIPMENT_SLOT_LABELS[slot],
      name: item?.name,
      stats: item ? formatEquipmentStatLine(item) : '',
    }
  })
}

/** 敌人近战伤害：骰面 + 攻击力（同角色公式，无技能加值） */
export function resolveEnemyMeleeDamage(
  poolId: string,
  dice: { count: number; sides: number },
  opts: { isCrit?: boolean } = {},
): { values: number[]; total: number } | undefined {
  const input = enemyCombatInput(poolId)
  if (!input) return undefined
  const values = Array.from({ length: dice.count }, () => 1 + Math.floor(Math.random() * dice.sides))
  const diceSum = values.reduce((a, b) => a + b, 0)
  let total = diceSum
  if (opts.isCrit) {
    total = Math.floor(total * computeCritDamageMultiplier(input))
  }
  return { values, total }
}

export function enemyStatBlockUsesDerivedHp(block: EnemyStatBlock): boolean {
  return !!block.equipment && hasAnyEquipment(block.equipment)
}
