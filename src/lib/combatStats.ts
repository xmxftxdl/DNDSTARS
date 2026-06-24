import type { Abilities, Character, CombatSkill } from '../types/character'
import type { CharacterEquipment, EquipmentItem, EquipmentSlot, LegacyCharacterEquipment } from '../types/equipment'
import { abilityMod, type AbilityKey } from './dnd'
import { eagleEyeDexBonus, findClassTrait } from './classFeatures'
import {
  CRIT_RING,
  DEFAULT_ARCHER_EQUIPMENT,
  EQUIPMENT_SLOTS,
  LEATHER_ARMOR,
  LEATHER_CAP,
  LONG_BOW,
} from './equipmentDefaults'
import { isArcherLineClass } from './archerSkillTree'

/**
 * [T7/AC5/B8] 敌人 AC 缺省值的唯一真相源。
 * 此前分散在 enemyCombatStats(??12)/combatStats(??10)/AIPage(12) 三处取值不一，
 * 现统一为本常量，调和为 12。（EnemyDetailPanel 的 ??20 是 maxHp 回退，非 AC，不在此列。）
 */
export const DEFAULT_ENEMY_AC = 12

/** 角色 / 敌人共用的战斗数值输入 */
export interface CombatStatInput {
  abilities: Abilities
  level?: number
  equipment?: CharacterEquipment
  /** 鹰眼等临时敏捷加成（原始分值，非调整值） */
  bonusDexScore?: number
  acFallback?: number
}

export interface EquipmentBonuses {
  ac: number
  physicalAttack: number
  magicAttack: number
  defense: number
  magicDefense: number
  hpBonus: number
  critDamagePercent: number
}

const EMPTY_BONUSES: EquipmentBonuses = {
  ac: 0,
  physicalAttack: 0,
  magicAttack: 0,
  defense: 0,
  magicDefense: 0,
  hpBonus: 0,
  critDamagePercent: 0,
}

export function characterToCombatInput(c: Character): CombatStatInput {
  let bonusDexScore = 0
  if ((c.combatBuffs?.eagleEyeTurns ?? 0) > 0) {
    const trait = findClassTrait(c, 'eagleEye')
    if (trait) bonusDexScore = eagleEyeDexBonus(trait.level)
  }
  return {
    abilities: c.abilities,
    level: c.level,
    equipment: c.equipment,
    bonusDexScore,
    acFallback: c.ac,
  }
}

function effectiveAbilityScore(input: CombatStatInput, key: AbilityKey): number {
  let score = input.abilities[key]
  if (key === 'dex') score += input.bonusDexScore ?? 0
  return score
}

export function getEquippedItems(equipment?: CharacterEquipment): EquipmentItem[] {
  if (!equipment) return []
  return EQUIPMENT_SLOTS.map((slot) => equipment[slot]).filter((item): item is EquipmentItem => !!item)
}

function foldBonuses(items: EquipmentItem[]): EquipmentBonuses {
  return items.reduce<EquipmentBonuses>(
    (acc, item) => ({
      ac: acc.ac + (item.ac ?? 0),
      physicalAttack: acc.physicalAttack + (item.physicalAttack ?? 0),
      magicAttack: acc.magicAttack + (item.magicAttack ?? 0),
      defense: acc.defense + (item.defense ?? 0),
      magicDefense: acc.magicDefense + (item.magicDefense ?? 0),
      hpBonus: acc.hpBonus + (item.hpBonus ?? 0),
      critDamagePercent: acc.critDamagePercent + (item.critDamagePercent ?? 0),
    }),
    { ...EMPTY_BONUSES },
  )
}

export function sumEquipmentBonuses(equipment?: CharacterEquipment): EquipmentBonuses {
  return foldBonuses(getEquippedItems(equipment))
}

function sumWeaponBonuses(equipment?: CharacterEquipment): Pick<EquipmentBonuses, 'physicalAttack' | 'magicAttack'> {
  const weapons = [equipment?.mainWeapon, equipment?.offHand].filter((item): item is EquipmentItem => !!item)
  const folded = foldBonuses(weapons)
  return { physicalAttack: folded.physicalAttack, magicAttack: folded.magicAttack }
}

/** 护甲等级 AC（来自装备，与防御力独立） */
export function computeAc(input: CombatStatInput): number {
  const equip = sumEquipmentBonuses(input.equipment)
  if (equip.ac > 0) return equip.ac
  return input.acFallback ?? DEFAULT_ENEMY_AC
}

/** 攻击力 = 武器攻击力 + 敏捷 × 2 */
export function computePhysicalAttack(input: CombatStatInput): number {
  const weapon = sumWeaponBonuses(input.equipment)
  const dex = effectiveAbilityScore(input, 'dex')
  return weapon.physicalAttack + dex * 2
}

/** 防御力 = 护甲防御力 + 体质 × 1.5 */
export function computeDefense(input: CombatStatInput): number {
  const equip = sumEquipmentBonuses(input.equipment)
  return equip.defense + input.abilities.con * 1.5
}

/** 魔法攻击力 = 魔法武器攻击力 + 智力 × 2 */
export function computeMagicAttack(input: CombatStatInput): number {
  const weapon = sumWeaponBonuses(input.equipment)
  return weapon.magicAttack + input.abilities.int * 2
}

/** 魔法防御力 = 装备魔防 + 感知 × 1.5 */
export function computeMagicDefense(input: CombatStatInput): number {
  const equip = sumEquipmentBonuses(input.equipment)
  return equip.magicDefense + input.abilities.wis * 1.5
}

/** 生命值 = 6 + 等级 × 体质调整值 + 装备生命加成 */
export function computeMaxHp(input: CombatStatInput): number {
  const equip = sumEquipmentBonuses(input.equipment)
  const level = Math.max(1, input.level ?? 1)
  return Math.max(1, 6 + level * abilityMod(input.abilities.con) + equip.hpBonus)
}

/** 暴击伤害倍率：125% + 装备暴伤加成 + 敏捷 × 1.5% */
export function computeCritDamageMultiplier(input: CombatStatInput): number {
  const equip = sumEquipmentBonuses(input.equipment)
  const dex = effectiveAbilityScore(input, 'dex')
  const percent = 125 + equip.critDamagePercent + dex * 1.5
  return percent / 100
}

export function formatCritDamagePercentFromInput(input: CombatStatInput): string {
  return `${Math.round(computeCritDamageMultiplier(input) * 100)}%`
}

export function getAc(c: Character): number {
  return computeAc(characterToCombatInput(c))
}

export function getPhysicalAttack(c: Character): number {
  return computePhysicalAttack(characterToCombatInput(c))
}

export function getDefense(c: Character): number {
  return computeDefense(characterToCombatInput(c))
}

export function getMagicAttack(c: Character): number {
  return computeMagicAttack(characterToCombatInput(c))
}

export function getMagicDefense(c: Character): number {
  return computeMagicDefense(characterToCombatInput(c))
}

export function getMaxHp(c: Character): number {
  return computeMaxHp(characterToCombatInput(c))
}

export function getCritDamageMultiplier(c: Character): number {
  return computeCritDamageMultiplier(characterToCombatInput(c))
}

export function formatCritDamagePercent(c: Character): string {
  return formatCritDamagePercentFromInput(characterToCombatInput(c))
}

export function isMagicDamageSkill(skill: CombatSkill): boolean {
  return (
    skill.skillTreeId === 'focusShot' ||
    skill.skillTreeId === 'refluxMagicArrow' ||
    skill.skillTreeId === 'antiMagicArrow' ||
    skill.skillTreeId === 'explosiveArrow'
  )
}

export type DamageReductionType = 'physical' | 'magic' | 'true'

/** 攻防差值 → 伤害修正（攻击方攻击力 − 防守方防御力） */
export const ATTACK_DEFENSE_DAMAGE_MOD_TABLE: readonly { lo: number; hi: number; mod: number }[] = [
  { lo: Number.NEGATIVE_INFINITY, hi: -80, mod: -10 },
  { lo: -79, hi: -67, mod: -9 },
  { lo: -66, hi: -55, mod: -8 },
  { lo: -54, hi: -44, mod: -7 },
  { lo: -43, hi: -34, mod: -6 },
  { lo: -33, hi: -25, mod: -5 },
  { lo: -24, hi: -17, mod: -4 },
  { lo: -16, hi: -11, mod: -3 },
  { lo: -10, hi: -6, mod: -2 },
  { lo: -5, hi: -3, mod: -1 },
  { lo: -2, hi: 3, mod: 0 },
  { lo: 4, hi: 8, mod: 1 },
  { lo: 9, hi: 15, mod: 2 },
  { lo: 16, hi: 24, mod: 3 },
  { lo: 25, hi: 34, mod: 4 },
  { lo: 35, hi: 45, mod: 5 },
  { lo: 46, hi: 58, mod: 6 },
  { lo: 59, hi: 72, mod: 7 },
  { lo: 73, hi: 87, mod: 8 },
  { lo: 88, hi: 104, mod: 9 },
  { lo: 105, hi: Number.POSITIVE_INFINITY, mod: 10 },
] as const

export function damageModifierFromAttackDefenseDiff(diff: number): number {
  for (const row of ATTACK_DEFENSE_DAMAGE_MOD_TABLE) {
    if (diff >= row.lo && diff <= row.hi) return row.mod
  }
  return 0
}

export function getAttackDefenseDiff(
  attacker: CombatStatInput,
  defender: CombatStatInput,
  type: 'physical' | 'magic',
): number {
  const atk = type === 'magic' ? computeMagicAttack(attacker) : computePhysicalAttack(attacker)
  const def = Math.round(type === 'magic' ? computeMagicDefense(defender) : computeDefense(defender))
  return Math.round(atk - def)
}

export interface AttackDefenseDamageAdjust {
  damage: number
  diff: number
  modifier: number
}

// [T4/C3] 脆弱：承受伤害 +25%（即「物防/魔防 -25%」承诺的机制实现）。作为攻防修正之后的
// 最终乘子统一施加，覆盖该函数的所有分支。
export const VULNERABLE_DAMAGE_MULTIPLIER = 1.25

/** 按攻防差值表对伤害加/减值（替代原防御力直减）。defenderVulnerable=true 时再叠加脆弱乘子。 */
export function applyAttackDefenseDamageModifier(
  baseDamage: number,
  attacker: CombatStatInput | undefined,
  defender: CombatStatInput | undefined,
  type: DamageReductionType,
  defenderVulnerable = false,
): AttackDefenseDamageAdjust {
  // defenderVulnerable 默认 false → vulnMult=1 → 对整数伤害逐字节不变（无回归）。
  const vulnMult = defenderVulnerable ? VULNERABLE_DAMAGE_MULTIPLIER : 1
  if (type === 'true' || baseDamage <= 0 || !attacker || !defender) {
    return { damage: Math.max(0, Math.floor(baseDamage * vulnMult)), diff: 0, modifier: 0 }
  }
  const diff = getAttackDefenseDiff(attacker, defender, type)
  const modifier = damageModifierFromAttackDefenseDiff(diff)
  return {
    damage: Math.max(0, Math.floor((baseDamage + modifier) * vulnMult)),
    diff,
    modifier,
  }
}

export function resolveAttackDamageFromInput(
  input: CombatStatInput,
  skill: CombatSkill,
  diceValues: number[],
  opts: { isCrit?: boolean; useMagic?: boolean } = {},
): number {
  const diceSum = diceValues.reduce((a, b) => a + b, 0)
  const base = diceSum + skill.damageBonus
  if (opts.isCrit) return Math.floor(base * computeCritDamageMultiplier(input))
  return base
}

export function resolveAttackDamageTotal(
  caster: Character,
  skill: CombatSkill,
  diceValues: number[],
  opts: { isCrit?: boolean } = {},
): number {
  return resolveAttackDamageFromInput(characterToCombatInput(caster), skill, diceValues, opts)
}

export function migrateEquipment(equipment?: LegacyCharacterEquipment): CharacterEquipment {
  if (!equipment) return {}
  const legacy = equipment as LegacyCharacterEquipment & { weapon?: EquipmentItem }
  const migrated: CharacterEquipment = {
    mainWeapon: equipment.mainWeapon ?? legacy.weapon,
    offHand: equipment.offHand,
    armor: equipment.armor,
    helmet: equipment.helmet,
    shoes: equipment.shoes,
    ring: equipment.ring,
    necklace: equipment.necklace,
  }
  if (migrated.mainWeapon && (migrated.mainWeapon.slot as string) === 'weapon') {
    migrated.mainWeapon = { ...migrated.mainWeapon, slot: 'mainWeapon' }
  }
  return migrated
}

export function hasAnyEquipment(equipment?: CharacterEquipment): boolean {
  return getEquippedItems(equipment).length > 0
}

export function ensureDefaultEquipment(c: Character): Character {
  const equipment = migrateEquipment(c.equipment)
  if (hasAnyEquipment(equipment)) return { ...c, equipment }
  if (!isArcherLineClass(c.charClass)) return { ...c, equipment }
  return { ...c, equipment: { ...DEFAULT_ARCHER_EQUIPMENT } }
}

export function refreshKnownEquipment(c: Character): Character {
  if (!isArcherLineClass(c.charClass)) {
    return { ...c, equipment: migrateEquipment(c.equipment) }
  }
  let equipment = migrateEquipment(c.equipment)
  const upsert = (slot: EquipmentSlot, item: EquipmentItem) => {
    const current = equipment[slot]
    if (!current || current.id === item.id) {
      equipment = setEquipmentSlot(equipment, slot, item)
    }
  }
  upsert('mainWeapon', LONG_BOW)
  upsert('armor', LEATHER_ARMOR)
  upsert('helmet', LEATHER_CAP)
  upsert('ring', CRIT_RING)
  if (!hasAnyEquipment(equipment)) {
    equipment = { ...DEFAULT_ARCHER_EQUIPMENT }
  }
  return { ...c, equipment }
}

export function syncCombatDerivedStats(c: Character): Character {
  const maxHp = getMaxHp(c)
  const ac = getAc(c)
  return {
    ...c,
    maxHp,
    ac,
    currentHp: Math.min(c.currentHp, maxHp),
  }
}

export function formatEquipmentStatLine(item: EquipmentItem): string {
  const parts: string[] = []
  if (item.ac != null) parts.push(`AC ${item.ac}`)
  if (item.physicalAttack) parts.push(`物攻 +${item.physicalAttack}`)
  if (item.magicAttack) parts.push(`法攻 +${item.magicAttack}`)
  if (item.defense) parts.push(`物防 +${item.defense}`)
  if (item.magicDefense) parts.push(`法防 +${item.magicDefense}`)
  if (item.hpBonus) parts.push(`生命 +${item.hpBonus}`)
  if (item.critDamagePercent) parts.push(`暴伤 +${item.critDamagePercent}%`)
  return parts.join(' · ') || '—'
}

export function setEquipmentSlot(
  equipment: CharacterEquipment | undefined,
  slot: EquipmentSlot,
  item: EquipmentItem | undefined,
): CharacterEquipment {
  return { ...(equipment ?? {}), [slot]: item }
}
