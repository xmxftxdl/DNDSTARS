import type { BattleMap, Token } from '../store/maps'
import type { Character, CombatSkill } from '../types/character'
import { abilityMod, proficiencyBonus, type AbilityKey } from './dnd'
import { DND_FEET_PER_CELL } from './gridCombat'
import {
  findClassTrait,
  getClassFeatureDef,
  isSingleArrowSkill,
  pixelToCell,
  eagleEyeDexBonus,
} from './classFeatures'
import { resolveAttackDamageTotal } from './combatStats'

export function rollD20(): number {
  return 1 + Math.floor(Math.random() * 20)
}

/** 鹰眼激活时临时增加的敏捷值（非调整值） */
export function getEagleEyeDexScoreBonus(c: Character): number {
  if ((c.combatBuffs?.eagleEyeTurns ?? 0) <= 0) return 0
  const trait = findClassTrait(c, 'eagleEye')
  return trait ? eagleEyeDexBonus(trait.level) : 0
}

export function getEffectiveAbilityScore(c: Character, key: AbilityKey): number {
  let score = c.abilities[key]
  if (key === 'dex') score += getEagleEyeDexScoreBonus(c)
  return score
}

export function getEffectiveAbilityMod(c: Character, key: AbilityKey): number {
  return abilityMod(getEffectiveAbilityScore(c, key))
}

export interface RangedAttackOptions {
  targetHuntingMarks?: number
  advantage?: boolean
  disadvantage?: boolean
  critThreshold?: number
  // [T12/F4] d20 / d20Second / damageValues 由调用方（MapsPage 的 dice-box 抽样）
  // 权威供给——显示值与结算值同源。原先的 `?? rollD20()` / `?? Array.from(Math.random())`
  // 回退在该路径下从不执行（死代码），且会引入「显示≠结算」的第二个 RNG，故移除：
  // d20 与 damageValues 改为必填，d20Second 在优势时由调用方供给。
  d20: number
  d20Second?: number
  damageValues: number[]
  /** 精准打击：本次攻击必定重击 */
  forceCrit?: boolean
  /** 攻击属性（默认敏捷） */
  ability?: AbilityKey
}

export function rangedAttackBonus(caster: Character, skill: CombatSkill, ability: AbilityKey = 'dex'): number {
  const prof =
    caster.combatSkills.some((s) => s.name === skill.name) ? proficiencyBonus(caster.level) : 0
  return getEffectiveAbilityMod(caster, ability) + prof
}

/** 目标后方直线 10 尺内最近的一名角色 */
export function findTokenBehindTarget(
  map: BattleMap,
  from: { x: number; y: number },
  target: Token,
  tokens: Token[],
  excludeIds: Set<string>,
  rangeFeet = 10,
): Token | null {
  const fromCell = pixelToCell(from.x, from.y, map)
  const targetCell = pixelToCell(target.x, target.y, map)
  const dc = targetCell.col - fromCell.col
  const dr = targetCell.row - fromCell.row
  if (dc === 0 && dr === 0) return null

  const sc = dc === 0 ? 0 : dc > 0 ? 1 : -1
  const sr = dr === 0 ? 0 : dr > 0 ? 1 : -1
  const maxCells = Math.max(1, Math.floor(rangeFeet / DND_FEET_PER_CELL))

  for (let step = 1; step <= maxCells; step++) {
    const cell = { col: targetCell.col + sc * step, row: targetCell.row + sr * step }
    const found = tokens.find((t) => {
      if (excludeIds.has(t.id)) return false
      const tc = pixelToCell(t.x, t.y, map)
      return tc.col === cell.col && tc.row === cell.row
    })
    if (found) return found
  }
  return null
}

export interface RangedAttackResult {
  d20: number
  d20Second?: number
  attackBonus: number
  attackTotal: number
  ac: number
  hit: boolean
  isCrit: boolean
  damageValues: number[]
  damageTotal: number
}

export function attackDamageDiceCount(skill: CombatSkill, doubleArrow: boolean): number {
  if (doubleArrow && isSingleArrowSkill(skill)) {
    return skill.skillTreeId === 'basicShot' || skill.name === '基础射击' ? 2 : (skill.damageCount || 1) * 2
  }
  if ((skill.skillTreeId === 'multiShot' || skill.skillTreeId === 'encircle') && (skill.arrowShots ?? 1) > 1) {
    return skill.damageCount * (skill.arrowShots ?? 1)
  }
  return skill.damageCount
}

export function resolveRangedAttackRoll(
  caster: Character,
  skill: CombatSkill,
  targetAc: number,
  doubleArrow: boolean,
  opts: RangedAttackOptions,
): RangedAttackResult {
  const diceCount = attackDamageDiceCount(skill, doubleArrow)
  const attackBonus = rangedAttackBonus(caster, skill, opts.ability ?? 'dex')

  // [T12/F4] d20 / d20Second 由调用方权威供给——不再回退到本地 rollD20()。
  const d20a = opts.d20
  const d20b = opts.d20Second
  const d20 = d20b != null ? Math.max(d20a, d20b) : d20a

  const attackTotal = d20 + attackBonus

  const critThreshold = Math.max(1, Math.min(20, opts.critThreshold ?? 20))
  const isCrit = opts.forceCrit || d20 >= critThreshold
  const hit = opts.forceCrit || isCrit || attackTotal >= targetAc

  // [T12/F4] 伤害骰值由调用方权威供给——不再回退到本地 Math.random()。
  const damageValues = hit ? opts.damageValues.slice(0, diceCount) : []
  let damageTotal = 0
  if (hit) {
    damageTotal = resolveAttackDamageTotal(caster, skill, damageValues, {
      isCrit: isCrit && !doubleArrow,
    })
  }

  return {
    d20,
    d20Second: d20b,
    attackBonus,
    attackTotal,
    ac: targetAc,
    hit,
    isCrit,
    damageValues,
    damageTotal,
  }
}

/** 敌人攻击：敏捷豁免，失败全额 / 成功减半 */
export function resolveDexSaveDamage(
  target: Character,
  fullDamage: number,
  dc: number,
  // [T12/F4] 豁免 d20 由调用方（dice-box 抽样）权威供给——移除 `?? rollD20()` 回退。
  providedD20: number,
): { saveD20: number; saveMod: number; saveTotal: number; dc: number; success: boolean; damage: number } {
  const saveD20 = providedD20
  const saveMod = getEffectiveAbilityMod(target, 'dex')
  const saveTotal = saveD20 + saveMod
  const success = saveTotal >= dc
  const damage = success ? Math.floor(fullDamage / 2) : fullDamage
  return { saveD20, saveMod, saveTotal, dc, success, damage }
}

export function formatEagleEyeDescription(featureRank: number): string {
  const def = getClassFeatureDef('eagleEye')
  return def ? def.description.replace(/\{uses\}/g, String(featureRank)) : ''
}
