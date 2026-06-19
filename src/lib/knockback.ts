import type { BattleMap, Token } from '../store/maps'
import type { Character, CombatSkill } from '../types/character'
import { abilityMod, type AbilityKey } from './dnd'
import { cellToPixel, pixelToCell, type GridCell } from './gridCombat'
import { getEnemyStatBlock } from './enemyStatBlocks'
import { getArcherSkillDef, getSkillRank, skillGrantsKnockback } from './archerSkillTree'
import { rollD20, getEffectiveAbilityMod } from './archerCombat'

export const KNOCKBACK_ICON = '/icons/knockback.png'
export const KNOCKBACK_STATUS_LABEL = '击飞'
/** 击飞状态默认持续回合数 */
export const KNOCKBACK_DEFAULT_TURNS = 1
/** 豁免失败时沿远离施法者方向推动格数 */
export const KNOCKBACK_PUSH_CELLS = 1

export interface KnockbackSaveResult {
  saveD20: number
  saveD20Second?: number
  saveMod: number
  saveTotal: number
  dc: number
  success: boolean
}

export function skillHasKnockback(skill: CombatSkill): boolean {
  return skill.knockbackOnHit === true
}

/** 根据技能树 id 与角色等级推断击飞（技能树为准，覆盖旧存档 knockbackOnHit） */
export function inferKnockbackFromSkillTree(c: Character, skill: CombatSkill): boolean {
  if (!skill.skillTreeId) return skill.knockbackOnHit === true
  const def = getArcherSkillDef(skill.skillTreeId)
  if (!def) return skill.knockbackOnHit === true
  const rank = getSkillRank(c, skill.skillTreeId)
  return skillGrantsKnockback(def.id, rank)
}

/** 本次攻击是否触发击飞敏捷豁免 */
export function skillGrantsKnockbackOnHit(c: Character, skill: CombatSkill): boolean {
  return skillHasKnockback(skill) || inferKnockbackFromSkillTree(c, skill)
}

export function getTokenAbilityMod(
  token: Token,
  key: AbilityKey,
  targetChar?: Character,
): number {
  if (targetChar) return getEffectiveAbilityMod(targetChar, key)
  if (token.poolId) {
    const stats = getEnemyStatBlock(token.poolId)
    if (stats) return abilityMod(stats.abilities[key])
  }
  return 0
}

export function resolveKnockbackSave(
  caster: Character,
  token: Token,
  targetChar?: Character,
  options?: { disadvantage?: boolean; d20?: number; d20Second?: number },
): KnockbackSaveResult {
  const dc = caster.saveDC
  const saveMod = getTokenAbilityMod(token, 'dex', targetChar)
  const d20a = options?.d20 ?? rollD20()
  const d20b = options?.d20Second ?? (options?.disadvantage ? rollD20() : undefined)
  const saveD20 = d20b != null ? Math.min(d20a, d20b) : d20a
  const saveTotal = saveD20 + saveMod
  const success = saveTotal >= dc
  return {
    saveD20,
    saveD20Second: d20b,
    saveMod,
    saveTotal,
    dc,
    success,
  }
}

function normalizeStep(dc: number, dr: number): { dc: number; dr: number } {
  if (dc === 0 && dr === 0) return { dc: 0, dr: -1 }
  const len = Math.hypot(dc, dr)
  return { dc: Math.round(dc / len), dr: Math.round(dr / len) }
}

/** 将 token 沿远离 from 的方向推动若干格 */
export function pushTokenFromPoint(
  map: BattleMap,
  token: Token,
  from: { x: number; y: number },
  cells = KNOCKBACK_PUSH_CELLS,
): { x: number; y: number } {
  const tokenCell = pixelToCell(token.x, token.y, map)
  const fromCell = pixelToCell(from.x, from.y, map)
  let { dc, dr } = normalizeStep(tokenCell.col - fromCell.col, tokenCell.row - fromCell.row)
  const next: GridCell = {
    col: tokenCell.col + dc * cells,
    row: tokenCell.row + dr * cells,
  }
  return cellToPixel(next, map)
}

export function formatKnockbackSaveLabel(save: KnockbackSaveResult): string {
  const roll =
    save.saveD20Second != null
      ? `（劣势 ${save.saveD20}/${save.saveD20Second}）`
      : ''
  const outcome = save.success ? '成功，未被击飞' : '失败，被击飞'
  return `击飞 · 敏捷豁免${roll} ${save.saveD20}+${save.saveMod} vs DC${save.dc} ${outcome}`
}
