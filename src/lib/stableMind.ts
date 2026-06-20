import type { Character } from '../types/character'
import { findClassTrait } from './classFeatures'
import { resolveDexSaveDamage } from './archerCombat'

export function hasStableMind(c: Character): boolean {
  return !!findClassTrait(c, 'stableMind')
}

export interface StableMindOfferResult {
  /** 最终应造成的伤害 */
  damage: number
  /** 是否使用了残影脱身 */
  usedStableMind: boolean
  /** 附加到战报的标签 */
  note?: string
}

/** 敏捷豁免（成功半伤）结算后，可选残影脱身抵消剩余伤害 */
export function applyStableMindAfterDexSave(
  character: Character,
  dexSaveSuccess: boolean,
  damageAfterSave: number,
  onSpend: () => boolean,
): StableMindOfferResult {
  if (!dexSaveSuccess || damageAfterSave <= 0 || !hasStableMind(character)) {
    return { damage: damageAfterSave, usedStableMind: false }
  }

  const trait = findClassTrait(character, 'stableMind')!
  const canSpend = trait.uses > 0 && character.currentAP >= 1

  if (!canSpend) {
    return { damage: damageAfterSave, usedStableMind: false }
  }

  const ok = window.confirm(
    `残影脱身\n\n敏捷豁免已成功，仍将受到 ${damageAfterSave} 点伤害。\n是否消耗 1 AP 抵消本次全部伤害？\n（长休剩余 ${trait.uses}/${trait.maxUses} 次）`,
  )

  if (!ok) {
    return { damage: damageAfterSave, usedStableMind: false }
  }

  if (!onSpend()) {
    return { damage: damageAfterSave, usedStableMind: false }
  }

  return {
    damage: 0,
    usedStableMind: true,
    note: '残影脱身：已抵消全部伤害',
  }
}

export interface IncomingDexSaveDamage {
  fullDamage: number
  finalDamage: number
  saveD20: number
  saveMod: number
  saveTotal: number
  dc: number
  success: boolean
  stableMindNote?: string
}

/** 对角色造成需敏捷豁免的伤害（成功减半），并处理残影脱身 */
export function resolveIncomingDexSaveDamage(
  character: Character,
  fullDamage: number,
  dc: number,
  onStableMindSpend: () => boolean,
  // [T12/F4] 豁免 d20 由调用方权威供给（与 resolveDexSaveDamage 一致）。
  providedD20: number,
): IncomingDexSaveDamage {
  const save = resolveDexSaveDamage(character, fullDamage, dc, providedD20)
  const stable = applyStableMindAfterDexSave(
    character,
    save.success,
    save.damage,
    onStableMindSpend,
  )
  return {
    fullDamage,
    finalDamage: stable.damage,
    saveD20: save.saveD20,
    saveMod: save.saveMod,
    saveTotal: save.saveTotal,
    dc: save.dc,
    success: save.success,
    stableMindNote: stable.note,
  }
}

export function formatDexSaveLabel(result: IncomingDexSaveDamage): string {
  const outcome = result.success ? '成功（半伤）' : '失败（全额）'
  let label = `敏捷豁免 ${result.saveD20}+${result.saveMod} vs DC${result.dc} ${outcome}`
  if (result.stableMindNote) label += ` · ${result.stableMindNote}`
  return label
}
