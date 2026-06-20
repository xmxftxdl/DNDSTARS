// [T15/G3] MapsPage 纯 helper 抽取。从 MapsPage.tsx 原样搬出——不改名、不改逻辑。
// 这些是 god-object 中无闭包依赖的模块级纯函数，搬到独立边界后 MapsPage 直接 import 回去。
// reconcileEnemyAp 维持 export（enemyApReconcile.test.ts 经 MapsPage re-export 引用）。
import type { InitiativeEntry } from '../components/map/InitiativeTracker'
import type { DeleteSelectionRect } from '../components/map/MapCanvas'
import { getEffectiveAbilityMod } from '../lib/archerCombat'
import { isBasicShot } from '../lib/classFeatures'
import type { Token } from '../store/maps'
import type { Character, CombatSkill } from '../types/character'
import type { StatusType } from './mapsPageTypes'

/**
 * [T10/AC4 · E13] enemyAP 的「读到的快照」如何调和进当前态。
 * enemyApByToken 本就是 SharedCombatState 的字段、随 publishCombatState 持久化、loadShared 时 restore —
 * 已是服务端持久化（重连/刷新可恢复已花 AP）。本 helper 只硬化「撕裂读」边界：
 *  - 快照带了 enemyApByToken（即便是 {}）⇒ 这是权威全量，按它来（过滤掉已不存在的 token）。
 *  - 快照里该字段缺失（undefined，撕裂/旧形状）且本端仍持有已花 AP ⇒ 保留本端，不要把已花 AP
 *    冲回空（空会让 tokenHp 显示回落到默认 {2,2}，等于凭空恢复 AP）。
 * 纯函数，便于 T13 在不挂载组件下单测 restore-fires 与 torn-read-preserve 两条路径。
 */
export function reconcileEnemyAp(
  incoming: Record<string, { current: number; max: number }> | undefined,
  existing: Record<string, { current: number; max: number }>,
  validTokenIds: Set<string>,
): Record<string, { current: number; max: number }> {
  // 撕裂读：字段缺失但本端已有已花 AP ⇒ 原样保留（仅过滤无效 token）。
  if (incoming === undefined && Object.keys(existing).length > 0) {
    return Object.fromEntries(
      Object.entries(existing).filter(([tokenId]) => validTokenIds.has(tokenId)),
    )
  }
  // 字段存在（含 {}）⇒ 权威全量，按它来。
  return Object.fromEntries(
    Object.entries(incoming ?? {}).filter(([tokenId]) => validTokenIds.has(tokenId)),
  )
}

const SINGLE_TARGET_RANGE_FEET: Record<string, number> = {
  basicShot: 90,
  multiShot: 30,
  clusterShot: 20,
  netArrow: 60,
  explosiveArrow: 60,
  vineHookShot: 20,
  magicArrow: 60,
  arcaneBreak: 90,
  windStepShot: 60,
}

export function singleTargetRangeFeet(skill: CombatSkill): number | null {
  if (!skill.tags?.includes('ranged') && !isBasicShot(skill)) return null
  if (skill.skillTreeId && SINGLE_TARGET_RANGE_FEET[skill.skillTreeId] != null) {
    return SINGLE_TARGET_RANGE_FEET[skill.skillTreeId]
  }
  return 90
}

export function statusDuration(skill: CombatSkill, type: StatusType): number | undefined {
  if (skill.statusOnHit === type) return skill.statusDuration ?? (type === 'burning' ? 3 : 4)
  if (type === 'burning' && skill.name === '火球术') return skill.statusDuration ?? 3
  if (type === 'poison' && skill.name === '毒云术') return skill.statusDuration ?? 4
  return undefined
}

export function rollInitiative(_token: Token, character?: Character): number {
  const d20 = 1 + Math.floor(Math.random() * 20)
  if (character) {
    return d20 + getEffectiveAbilityMod(character, 'dex') + character.initiativeBonus
  }
  return d20 + Math.floor(Math.random() * 5)
}

export function buildInitiativeOrder(tokens: Token[], characters: Character[]): InitiativeEntry[] {
  return tokens
    .filter((token) => token.type !== 'obstacle')
    .map((token) => {
      const ch = token.characterId ? characters.find((c) => c.id === token.characterId) : undefined
      return {
        tokenId: token.id,
        label: token.label,
        emoji: token.emoji,
        color: token.color,
        accent: ch?.accent,
        roll: rollInitiative(token, ch),
      }
    })
    .sort((a, b) => b.roll - a.roll)
}

export function tokenIntersectsDeleteRect(token: Token, rect: DeleteSelectionRect, gridSize: number): boolean {
  const tokenSize = Math.max(1, token.size || 1) * gridSize
  const half = tokenSize / 2
  const left = token.x - half
  const right = token.x + half
  const top = token.y - half
  const bottom = token.y + half
  return right >= rect.x && left <= rect.x + rect.width && bottom >= rect.y && top <= rect.y + rect.height
}

// [T15/G3] 骰子种子 RNG。纯函数对，从 MapsPage 组件内闭包原样搬出（无 state/ref 捕获）。
// hashDiceSeed 仅供 seededDieValue 内部使用；后者用于 d20 超时兜底面值与 fly 索引派生。
function hashDiceSeed(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function seededDieValue(seed: string, sides: number): number {
  let state = hashDiceSeed(seed) || 1
  state = (state + 0x6d2b79f5) | 0
  let next = Math.imul(state ^ (state >>> 15), 1 | state)
  next ^= next + Math.imul(next ^ (next >>> 7), 61 | next)
  const unit = ((next ^ (next >>> 14)) >>> 0) / 4294967296
  return 1 + Math.floor(unit * Math.max(2, Math.round(sides)))
}
