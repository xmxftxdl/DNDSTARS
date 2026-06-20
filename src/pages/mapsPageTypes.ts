// [T15/G3] MapsPage 共享类型抽取。纯类型声明，无运行时——从 MapsPage.tsx 原样搬出，
// 不改名、不改结构，仅为给 7000+ 行的 god-object 拆出独立的类型边界。
// 这些 Shared* 形状是 DM/玩家两端通过 sharedApi 广播/读取的契约。
import type { InitiativeEntry } from '../components/map/InitiativeTracker'
import type { GridCell } from '../lib/gridCombat'
import type { EnemyTurnResult } from '../lib/enemyAi'
import type { ClassFeatureKey } from '../types/character'
import type { DiceRoll } from '../components/DiceRollOverlay'

export type Mode = 'dm' | 'player'

export interface SharedCombatState {
  mapId: string
  combatId?: string
  active: boolean
  round: number
  initiativeIndex: number
  initiativeOrder: InitiativeEntry[]
  enemyApByToken?: Record<string, { current: number; max: number }>
  updatedAt: number
}

export interface SharedDodgeState {
  id: string
  mapId: string
  status: 'pending' | 'rolling' | 'answered' | 'done'
  result: EnemyTurnResult
  targetCharId: string
  wantsDodge?: boolean
  dodgeD20?: number
  dodgeApSpent?: boolean
  expiresAt?: number
  updatedAt: number
}

export interface SharedStableMindState {
  id: string
  mapId: string
  status: 'pending' | 'answered' | 'done'
  targetCharId: string
  targetName: string
  fullDamage: number
  damageAfterSave: number
  saveD20: number
  saveMod: number
  saveTotal: number
  dc: number
  useStableMind?: boolean
  expiresAt?: number
  updatedAt: number
}

export interface SharedPlayerActionState {
  id: string
  mapId: string
  combatId?: string
  sourceMode: 'player'
  status: 'pending' | 'done'
  type: 'end-turn' | 'attack-token' | 'aoe-attack' | 'move-token' | 'qi-reduce-cooldown' | 'activate-feature'
  actorTokenId: string
  characterId: string
  targetTokenId?: string
  targetTokenIds?: string[]
  targetCell?: GridCell
  targetPosition?: { x: number; y: number }
  aoeRectRotation?: number
  skillId?: string
  featureKey?: ClassFeatureKey
  round: number
  initiativeIndex: number
  seq: number
  updatedAt: number
}

export interface SharedPlayerActionAckState {
  id: string
  mapId: string
  combatId?: string
  actionId: string
  status: 'accepted' | 'rejected'
  reason?: string
  acceptedPosition?: { x: number; y: number }
  round: number
  initiativeIndex: number
  updatedAt: number
}

export interface SharedDiceState {
  id: string
  mapId: string
  sourceMode: Mode
  status?: 'rolling' | 'result'
  kind?: 'd20' | 'dice'
  count?: number
  sides?: number
  values?: number[]
  flyIndex?: number
  label?: string
  targetName?: string
  roll?: DiceRoll
  updatedAt: number
}

export interface SharedDiceEventsState {
  mapId: string
  events: SharedDiceState[]
  updatedAt: number
}

// T-P2-398 (398-A, strangler): result-broadcast path. DM emits ONE seedless
// roll-request carrying the already-decided values; each end self-renders the
// @values face independently. Intentionally NO seed/diceSeed field (AC2) — the
// terminal face is carried by `values`, not reproduced from a seed. Lives on a
// dedicated channel so it never touches the old dice-stream frame path (AC4).
export interface SharedRollRequestEvent {
  eventId: string
  mapId: string
  sourceMode: Mode
  requestId: string
  kind: 'd20' | 'dice'
  count: number
  sides: number
  values: number[]
  label: string
  targetName: string
  updatedAt: number
}

export type SharedRollRequestPayload = Omit<
  SharedRollRequestEvent,
  'eventId' | 'mapId' | 'sourceMode' | 'updatedAt'
>

export interface SharedCombatLogState {
  mapId: string
  entries: CombatLogEntry[]
  updatedAt: number
}

export type StatusType = 'burning' | 'poison'
export type CombatLogEntry = {
  id: number
  round: number
  text: string
  kind: 'system' | 'turn' | 'attack' | 'damage'
  time: string
}
