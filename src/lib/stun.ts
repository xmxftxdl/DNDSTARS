import type { Token } from '../store/maps'
import type { Character } from '../types/character'
import { rollD20 } from './archerCombat'
import { getTokenAbilityMod } from './knockback'

export const STUN_STATUS_LABEL = '眩晕'
/** 眩晕默认持续回合数 */
export const STUN_DEFAULT_TURNS = 1

export interface ConSaveResult {
  saveD20: number
  saveD20Second?: number
  saveMod: number
  saveTotal: number
  dc: number
  success: boolean
}

export function resolveConSave(
  caster: Character,
  token: Token,
  targetChar?: Character,
  options?: { disadvantage?: boolean; d20?: number; d20Second?: number },
): ConSaveResult {
  const dc = caster.saveDC
  const saveMod = getTokenAbilityMod(token, 'con', targetChar)
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

export function formatConSaveLabel(save: ConSaveResult): string {
  const roll =
    save.saveD20Second != null
      ? `（劣势 ${save.saveD20}/${save.saveD20Second}）`
      : ''
  const outcome = save.success ? '成功，未眩晕' : '失败，眩晕'
  return `眩晕 · 体质豁免${roll} ${save.saveD20}+${save.saveMod} vs DC${save.dc} ${outcome}`
}
