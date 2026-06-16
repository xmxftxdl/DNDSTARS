import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Map as MapIcon,
  Upload,
  Grid3x3,
  Trash2,
  Skull,
  User,
  X,
  Crown,
  Swords,
  Play,
  Square,
  SkipForward,
  Ruler,
  UserPlus,
  ChevronUp,
  SlidersHorizontal,
  Maximize2,
  Minimize2,
  GripVertical,
  GripHorizontal,
  RefreshCw,
  Move,
  Magnet,
  Footprints,
} from 'lucide-react'
import EmptyState from '../components/EmptyState'
import MapCanvas from '../components/map/MapCanvas'
import type { MapProjectile } from '../components/map/MapCanvas'
import InitiativeTracker, {
  INITIATIVE_VISIBLE_MAX,
  type InitiativeEntry,
} from '../components/map/InitiativeTracker'
import SkillBar from '../components/character/SkillBar'
import type { InfiniteAction } from '../components/character/SkillBar'
import BulletMatchPanel from '../components/map/BulletMatchPanel'
import { isHeavyGunner } from '../lib/bulletMatch'
import FeaturesTab from '../components/character/FeaturesTab'
import CharacterRailEntry, {
  CHAR_PANEL_TITLES,
  type CharDockPanel,
} from '../components/map/CharacterRailEntry'
import QiIndicator from '../components/map/QiIndicator'
import MapInventoryPanel from '../components/map/MapInventoryPanel'
import MapSpellsPanel from '../components/map/MapSpellsPanel'
import EnemyPoolPicker from '../components/map/EnemyPoolPicker'
import EnemyDetailPanel, { canShowEnemyDetail } from '../components/map/EnemyDetailPanel'
import CharacterDetailPanel from '../components/map/CharacterDetailPanel'
import DiceRollOverlay from '../components/DiceRollOverlay'
import type { DiceRoll } from '../components/DiceRollOverlay'
import DiceBoxD20Overlay from '../components/DiceBoxD20Overlay'
import DiceBoxRollOverlay from '../components/DiceBoxRollOverlay'
import { useMapStore } from '../store/maps'
import type { Token } from '../store/maps'
import { useCharacterStore } from '../store/characters'
import { loadSharedResource, publishSharedEvent, saveSharedResource, subscribeSharedEvent } from '../lib/sharedApi'
import type { Character } from '../types/character'
import type { ClassFeatureKey, CombatSkill } from '../types/character'
import {
  canArmDoubleArrow,
  canUseArmorPiercing,
  canUseDoubleArrow,
  eagleEyeDexBonus,
  isBasicShot,
  findClassTrait,
} from '../lib/classFeatures'
import { isCalmMindActive, isOutOfBreath, triggerOutOfBreath } from '../lib/calmMind'
import { formatDexSaveLabel, resolveIncomingDexSaveDamage } from '../lib/stableMind'
import {
  canAttemptDodge,
  ENEMY_MELEE_ATTACK_BONUS,
  formatDodgePrompt,
  offerAgileLeap,
  offerGaleCombo,
  resolvePhysicalEnemyHit,
} from '../lib/archerBaseFeatures'
import { TOKEN_STATUS_CLEAR_PATCH } from '../lib/combatStatus'
import {
  attackDamageDiceCount,
  getEffectiveAbilityMod,
  resolveRangedAttackRoll,
} from '../lib/archerCombat'
import {
  applyAttackDefenseDamageModifier,
  characterToCombatInput,
  computeCritDamageMultiplier,
  damageModifierFromAttackDefenseDiff,
  formatCritDamagePercent,
  getAc,
  getAttackDefenseDiff,
  isMagicDamageSkill,
  resolveAttackDamageTotal,
} from '../lib/combatStats'
import { adjustDamageAgainstToken, enemyCombatInput, getTokenTargetAc } from '../lib/enemyCombatStats'
import {
  clampGridSize,
  cellKey,
  cellToPixel,
  DND_FEET_PER_CELL,
  gridSizeBounds,
  isWithinMovementRange,
  cellDistance,
  movementRadiusPx,
  pixelToCell,
  snapToCellCenter,
  TOKEN_MOVE_DURATION_S,
  type GridCell,
} from '../lib/gridCombat'
import {
  aoeConfirmHint,
  aoeUsesMouseAim,
  canPlaceAoe,
  isSelfOriginCircleAoe,
  cellsForAoe,
  formatAoeHint,
  getSkillAoeTargeting,
  tokensInCells,
  type SkillAoeTargeting,
} from '../lib/skillTargeting'
import { applyGridDetectPatch, detectGridFromBlob, detectImageGrid } from '../lib/gridDetect'
import { getImage } from '../lib/imageStore'
import { planEnemyTurn, type EnemyTurnResult } from '../lib/enemyAi'
import { decideDodge } from '../lib/aiPolicy'
import {
  checkCombatOutcome,
  isTokenAlive,
  isTokenDefeated,
  pruneInitiativeForToken,
} from '../lib/combatTokens'
import { enemyTemplateToTokenPatch, type EnemyTemplate } from '../lib/enemyPool'
import { IGNITE_STATUS_LABEL } from '../lib/ignite'
import {
  formatKnockbackSaveLabel,
  getTokenAbilityMod,
  KNOCKBACK_DEFAULT_TURNS,
  KNOCKBACK_STATUS_LABEL,
  resolveKnockbackSave,
  skillGrantsKnockbackOnHit,
  type KnockbackSaveResult,
} from '../lib/knockback'
import {
  formatConSaveLabel,
  resolveConSave,
  STUN_DEFAULT_TURNS,
  STUN_STATUS_LABEL,
} from '../lib/stun'
import { getSkillRank, skillGrantsStun } from '../lib/archerSkillTree'
import { getPlayerCharacter, playerViewCharacters } from '../lib/playerView'
import { proficiencyBonus } from '../lib/dnd'

type Mode = 'dm' | 'player'

interface SharedCombatState {
  mapId: string
  active: boolean
  round: number
  initiativeIndex: number
  initiativeOrder: InitiativeEntry[]
  enemyApByToken?: Record<string, { current: number; max: number }>
  updatedAt: number
}

let lastSharedCombatSnapshot = ''

interface SharedDodgeState {
  id: string
  mapId: string
  status: 'pending' | 'rolling' | 'answered' | 'done'
  result: EnemyTurnResult
  targetCharId: string
  wantsDodge?: boolean
  dodgeD20?: number
  dodgeApSpent?: boolean
  updatedAt: number
}

interface SharedDiceState {
  id: string
  mapId: string
  sourceMode: Mode
  status?: 'rolling' | 'result'
  kind?: 'd20' | 'dice'
  count?: number
  sides?: number
  values?: number[]
  diceSeed?: string
  traceFrames?: number[][]
  animationSeed?: string
  flyIndex?: number
  label?: string
  targetName?: string
  roll?: DiceRoll
  updatedAt: number
}

interface SharedDiceEventsState {
  mapId: string
  events: SharedDiceState[]
  updatedAt: number
}

type SharedDiceStreamEvent =
  | {
      eventId: string
      type: 'start'
      mapId: string
      sourceMode: Mode
      requestId: string
      kind: 'd20' | 'dice'
      count?: number
      sides?: number
      values?: number[]
      diceSeed?: string
      flyIndex?: number
      label: string
      targetName: string
      updatedAt: number
    }
  | {
      eventId: string
      type: 'frame'
      mapId: string
      sourceMode: Mode
      requestId: string
      kind: 'd20' | 'dice'
      frame: number[]
      index: number
      updatedAt: number
    }
  | {
      eventId: string
      type: 'complete'
      mapId: string
      sourceMode: Mode
      requestId: string
      kind: 'd20' | 'dice'
      value: number
      values?: number[]
      updatedAt: number
    }

type SharedDiceStreamPayload =
  | Omit<Extract<SharedDiceStreamEvent, { type: 'start' }>, 'eventId' | 'mapId' | 'sourceMode' | 'updatedAt'>
  | Omit<Extract<SharedDiceStreamEvent, { type: 'frame' }>, 'eventId' | 'mapId' | 'sourceMode' | 'updatedAt'>
  | Omit<Extract<SharedDiceStreamEvent, { type: 'complete' }>, 'eventId' | 'mapId' | 'sourceMode' | 'updatedAt'>

// T-P2-398 (398-A, strangler): result-broadcast path. DM emits ONE seedless
// roll-request carrying the already-decided values; each end self-renders the
// @values face independently. Intentionally NO seed/diceSeed field (AC2) — the
// terminal face is carried by `values`, not reproduced from a seed. Lives on a
// dedicated channel so it never touches the old dice-stream frame path (AC4).
interface SharedRollRequestEvent {
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

type SharedRollRequestPayload = Omit<
  SharedRollRequestEvent,
  'eventId' | 'mapId' | 'sourceMode' | 'updatedAt'
>

interface SharedCombatLogState {
  mapId: string
  entries: CombatLogEntry[]
  updatedAt: number
}

function modeFromPort(): Mode | null {
  if (window.location.port === '5173') return 'dm'
  if (window.location.port === '5174') return 'player'
  return null
}

type StatusType = 'burning' | 'poison'
type CombatLogEntry = {
  id: number
  round: number
  text: string
  kind: 'system' | 'turn' | 'attack' | 'damage'
  time: string
}

const STATUS_LABEL: Record<StatusType, string> = { burning: '燃烧', poison: '中毒' }
const RESTRAINED_STATUS_LABEL = '束缚'
const VULNERABLE_STATUS_LABEL = '脆弱'
const NO_MOVE_STATUS_LABEL = '无法移动'

const TOKEN_MOVE_MS = Math.ceil(TOKEN_MOVE_DURATION_S * 1000) + 80
const DICE_ROLL_MS = 3200

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

function singleTargetRangeFeet(skill: CombatSkill): number | null {
  if (!skill.tags?.includes('ranged') && !isBasicShot(skill)) return null
  if (skill.skillTreeId && SINGLE_TARGET_RANGE_FEET[skill.skillTreeId] != null) {
    return SINGLE_TARGET_RANGE_FEET[skill.skillTreeId]
  }
  return 90
}

function statusDuration(skill: CombatSkill, type: StatusType): number | undefined {
  if (skill.statusOnHit === type) return skill.statusDuration ?? (type === 'burning' ? 3 : 4)
  if (type === 'burning' && skill.name === '火球术') return skill.statusDuration ?? 3
  if (type === 'poison' && skill.name === '毒云术') return skill.statusDuration ?? 4
  return undefined
}

function rollInitiative(_token: Token, character?: Character): number {
  const d20 = 1 + Math.floor(Math.random() * 20)
  if (character) {
    return d20 + getEffectiveAbilityMod(character, 'dex') + character.initiativeBonus
  }
  return d20 + Math.floor(Math.random() * 5)
}

function buildInitiativeOrder(tokens: Token[], characters: Character[]): InitiativeEntry[] {
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

export default function MapsPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const maps = useMapStore((s) => s.maps)
  const selectedId = useMapStore((s) => s.selectedId)
  const select = useMapStore((s) => s.select)
  const addMap = useMapStore((s) => s.addMap)
  const updateMap = useMapStore((s) => s.updateMap)
  const removeMap = useMapStore((s) => s.removeMap)
  const addToken = useMapStore((s) => s.addToken)
  const addObstacle = useMapStore((s) => s.addObstacle)
  const addEnemyFromPool = useMapStore((s) => s.addEnemyFromPool)
  const addCharacterToken = useMapStore((s) => s.addCharacterToken)
  const updateToken = useMapStore((s) => s.updateToken)
  const removeToken = useMapStore((s) => s.removeToken)

  const characters = useCharacterStore((s) => s.characters)
  const resetCombatCooldowns = useCharacterStore((s) => s.resetCombatCooldowns)
  const beginTurn = useCharacterStore((s) => s.beginTurn)
  const endTurn = useCharacterStore((s) => s.endTurn)
  const useSkillStore = useCharacterStore((s) => s.useSkill)
  const useClassFeature = useCharacterStore((s) => s.useClassFeature)
  const spendQi = useCharacterStore((s) => s.spendQi)
  const damageChar = useCharacterStore((s) => s.damage)
  const notifyCombatMove = useCharacterStore((s) => s.notifyCombatMove)
  const spendAP = useCharacterStore((s) => s.spendAP)
  const updateChar = useCharacterStore((s) => s.update)

  const [mode, setMode] = useState<Mode | null>(() => {
    const portMode = modeFromPort()
    if (portMode) return portMode
    const saved = window.localStorage.getItem('stars-map-role')
    return saved === 'dm' || saved === 'player' ? saved : null
  })
  const [combatActive, setCombatActive] = useState(false)
  const [round, setRound] = useState(1)
  const [initiativeOrder, setInitiativeOrder] = useState<InitiativeEntry[]>([])
  const [initiativeIndex, setInitiativeIndex] = useState(0)
  const [initiativeScroll, setInitiativeScroll] = useState(0)
  const [enemyApByToken, setEnemyApByToken] = useState<Record<string, { current: number; max: number }>>({})
  const enemyApByTokenRef = useRef<Record<string, { current: number; max: number }>>({})
  const [combatLog, setCombatLog] = useState<CombatLogEntry[]>([])
  const [combatLogOpen, setCombatLogOpen] = useState(false)
  const [projectiles, setProjectiles] = useState<MapProjectile[]>([])
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null)
  const [selectedCharacterTokenId, setSelectedCharacterTokenId] = useState<string | null>(null)
  const [activeCharId, setActiveCharId] = useState<string | null>(null)
  const [charPanel, setCharPanel] = useState<CharDockPanel | null>(null)
  const [measureMode, setMeasureMode] = useState(false)
  const [showBar, setShowBar] = useState(true) // 顶部控件浮层是否显示
  const [gridDetecting, setGridDetecting] = useState(false)
  const [gridAdjustMode, setGridAdjustMode] = useState(false)
  const [gridSizePreview, setGridSizePreview] = useState(false)
  const [panelWidth, setPanelWidth] = useState(720)
  const [panelHeight, setPanelHeight] = useState(300)
  const [panelFull, setPanelFull] = useState(false)
  const [enemyPoolOpen, setEnemyPoolOpen] = useState(false)
  const [enemyPoolMode, setEnemyPoolMode] = useState<'add' | 'apply'>('add')
  const [enemyDetailOpen, setEnemyDetailOpen] = useState(true)
  const frameRef = useRef<HTMLDivElement>(null)

  // 释放伤害技能：等待选择目标
  const [targeting, setTargeting] = useState<{
    casterId: string
    skill: CombatSkill
    doubleArrow?: boolean
    aoe?: SkillAoeTargeting
    /** 疾风连击：本次释放免 AP */
    waiveAp?: boolean
  } | null>(null)
  const [aoePreviewCell, setAoePreviewCell] = useState<GridCell | null>(null)
  const [aoeRectRotation, setAoeRectRotation] = useState(0)
  const [roll, setRoll] = useState<DiceRoll | null>(null)
  const afterRollRef = useRef<(() => void) | null>(null)
  const afterRollCallbacksRef = useRef<(() => void)[]>([])
  const pendingDeathKeysRef = useRef(new Set<string>())
  const d20RequestCounterRef = useRef(0)
  const resolvingAoeRef = useRef(false)
  const applyingSharedCombatRef = useRef(false)
  const advancingTurnRef = useRef(false)
  const roundApResetKeysRef = useRef(new Set<string>())
  const [diceBoxD20, setDiceBoxD20] = useState<{
    id: number
    label: string
    targetName: string
    value?: number
    diceSeed?: string
    animationSeed?: string
    flyIndex?: number
    resolve: (value: number) => void
  } | null>(null)
  const diceBoxRollRequestCounterRef = useRef(0)
  const [diceBoxRoll, setDiceBoxRoll] = useState<{
    id: number
    count: number
    sides: number
    label: string
    targetName: string
    values: number[]
    animationSeed?: string
    flyIndex?: number
    resolve: (values: number[]) => void
  } | null>(null)
  const [sharedDicePreview, setSharedDicePreview] = useState<{
    id: string
    kind: 'd20' | 'dice'
    count: number
    sides: number
    values?: number[]
    diceSeed?: string
    traceFrames?: number[][]
    replayLive?: boolean
    liveFrame?: number[]
    liveFrameSeq?: number
    animationSeed?: string
    flyIndex?: number
    label: string
    targetName: string
  } | null>(null)
  // T-P2-398 (398-A): player-side self-render driven by the new roll-request
  // broadcast. Deliberately separate from sharedDicePreview so the old
  // dice-stream path (start/frame/complete) cannot clear or race it.
  const [rollRequestPreview, setRollRequestPreview] = useState<{
    id: string
    kind: 'd20' | 'dice'
    count: number
    sides: number
    values: number[]
    label: string
    targetName: string
  } | null>(null)

  useEffect(() => {
    if (!diceBoxD20) return
    const request = diceBoxD20
    const timer = window.setTimeout(() => {
      setDiceBoxD20((current) => (current?.id === request.id ? null : current))
      request.resolve(request.value ?? seededDieValue(`${request.diceSeed ?? request.id}:timeout`, 20))
    }, 4500)
    return () => window.clearTimeout(timer)
  }, [diceBoxD20])

  useEffect(() => {
    if (!diceBoxRoll) return
    const request = diceBoxRoll
    const timer = window.setTimeout(() => {
      setDiceBoxRoll((current) => (current?.id === request.id ? null : current))
      request.resolve(request.values)
    }, 22000)
    return () => window.clearTimeout(timer)
  }, [diceBoxRoll])

  useEffect(() => {
    if (!sharedDicePreview) return
    const id = sharedDicePreview.id
    const duration = sharedDicePreview.kind === 'd20' ? 3500 : 12000
    const timer = window.setTimeout(() => {
      setSharedDicePreview((current) => (current?.id === id ? null : current))
    }, duration)
    return () => window.clearTimeout(timer)
  }, [sharedDicePreview])

  // T-P2-398 (398-A): safety auto-clear for the roll-request self-render, in
  // case onComplete never fires (iframe stall). Longer than the overlay's own
  // min-visible window.
  useEffect(() => {
    if (!rollRequestPreview) return
    const id = rollRequestPreview.id
    const duration = rollRequestPreview.kind === 'd20' ? 6000 : 16000
    const timer = window.setTimeout(() => {
      setRollRequestPreview((current) => (current?.id === id ? null : current))
    }, duration)
    return () => window.clearTimeout(timer)
  }, [rollRequestPreview])
  const [dodgePrompt, setDodgePrompt] = useState<{
    result: EnemyTurnResult
    targetChar: Character
    onComplete: () => void
  } | null>(null)
  const [sharedDodgePrompt, setSharedDodgePrompt] = useState<{
    id: string
    result: EnemyTurnResult
    targetChar: Character
  } | null>(null)
  const [showMoveRange, setShowMoveRange] = useState(false)
  const [disengagedCharIds, setDisengagedCharIds] = useState<Set<string>>(() => new Set())
  const enemyAppliedKeysRef = useRef(new Set<string>())
  const enemyTurnTimersRef = useRef<number[]>([])
  const pendingSharedDodgeRef = useRef<{
    id: string
    result: EnemyTurnResult
    targetCharId: string
    onComplete: () => void
  } | null>(null)
  const suppressedDodgePromptIdsRef = useRef(new Set<string>())
  const seenSharedDiceIdsRef = useRef(new Set<string>())
  const seenDiceStreamEventIdsRef = useRef(new Set<string>())
  // T-P2-398 (398-A): dedup roll-request by requestId (AC3) — same requestId
  // arriving twice (SSE fan-out to multiple local endpoints) renders once.
  const seenRollRequestIdsRef = useRef(new Set<string>())
  const lastPublishedDiceFrameRef = useRef(new Map<string, number>())
  const pendingDiceStreamsRef = useRef(
    new Map<
      string,
      {
        diceSeed?: string
        flyIndex?: number
        kind: 'd20' | 'dice'
        count: number
        sides: number
        values?: number[]
        label: string
        targetName: string
        firstFrame?: number[]
        firstFrameSeq?: number
      }
    >(),
  )
  const seenSharedLogIdsRef = useRef(new Set<number>())

  const hashDiceSeed = (text: string): number => {
    let hash = 2166136261
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }

  const seededDieValue = (seed: string, sides: number): number => {
    let state = hashDiceSeed(seed) || 1
    state = (state + 0x6d2b79f5) | 0
    let next = Math.imul(state ^ (state >>> 15), 1 | state)
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next)
    const unit = ((next ^ (next >>> 14)) >>> 0) / 4294967296
    return 1 + Math.floor(unit * Math.max(2, Math.round(sides)))
  }

  useEffect(() => {
    enemyApByTokenRef.current = enemyApByToken
  }, [enemyApByToken])
  const playerTurnStartedRef = useRef(new Set<string>())
  const multiStrikeHitsRef = useRef<Record<string, number>>({})
  const initiativeIndexRef = useRef(0)
  const initiativeOrderRef = useRef<InitiativeEntry[]>([])

  useEffect(() => {
    initiativeIndexRef.current = initiativeIndex
  }, [initiativeIndex])

  const pushCombatLog = (
    text: string,
    kind: CombatLogEntry['kind'] = 'system',
    roundOverride = round,
  ) => {
    const entry: CombatLogEntry = {
      id: Date.now() + Math.random(),
      round: roundOverride,
      text,
      kind,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
    seenSharedLogIdsRef.current.add(entry.id)
    setCombatLog((current) => [entry, ...current].slice(0, 80))
    if (activeMap) {
      void (async () => {
        const current = await loadSharedResource<SharedCombatLogState>('combat-log')
        const entries = current?.mapId === activeMap.id ? current.entries ?? [] : []
        await saveSharedResource<SharedCombatLogState>('combat-log', {
          mapId: activeMap.id,
          entries: [entry, ...entries.filter((item) => item.id !== entry.id)].slice(0, 100),
          updatedAt: Date.now(),
        })
      })()
    }
  }

  const pushApLog = (
    character: Character | undefined,
    amount: number,
    action: string,
    detail?: string,
  ) => {
    if (!character) return
    const spentText = amount > 0 ? `花费 ${amount} AP` : '未消耗 AP'
    const remaining = Math.max(0, character.currentAP - amount)
    pushCombatLog(
      `${character.name} ${spentText}：${action}${detail ? `（${detail}）` : ''}。剩余 AP ${remaining}/${character.actionPoints}`,
      'turn',
    )
  }

  const publishSharedDiceEvent = (event: SharedDiceState) => {
    if (!activeMap) return
    void (async () => {
      const current = await loadSharedResource<SharedDiceEventsState>('dice-events')
      const events = current?.mapId === activeMap.id ? current.events ?? [] : []
      const nextEvents = [...events.filter((item) => item.id !== event.id), event]
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(-24)
      await saveSharedResource<SharedDiceEventsState>('dice-events', {
        mapId: activeMap.id,
        events: nextEvents,
        updatedAt: Date.now(),
      })
    })()
  }

  const publishDiceStream = (event: SharedDiceStreamPayload) => {
    if (!activeMap || !mode) return
    const requestId = 'requestId' in event ? event.requestId : `${Date.now()}`
    const index = 'index' in event ? event.index : 0
    const eventId = `${requestId}:${event.type}:${index}:${Date.now()}:${Math.random().toString(36).slice(2)}`
    const targetMode = mode === 'dm' ? 'player' : 'dm'
    void publishSharedEvent<SharedDiceStreamEvent>(`dice-stream-${mode}-to-${targetMode}`, {
      ...event,
      eventId,
      mapId: activeMap.id,
      sourceMode: mode,
      updatedAt: Date.now(),
    } as SharedDiceStreamEvent)
  }

  // T-P2-398 (398-A): broadcast the decided result once. One logical event per
  // throw (AC2); sharedApi fans it out to each local endpoint as the SSE
  // dual-send (the same eventId, deduped downstream by requestId).
  const publishRollRequest = (payload: SharedRollRequestPayload) => {
    if (!activeMap || !mode) return
    const targetMode = mode === 'dm' ? 'player' : 'dm'
    const eventId = `${payload.requestId}:roll-request:${Date.now()}:${Math.random().toString(36).slice(2)}`
    void publishSharedEvent<SharedRollRequestEvent>(`dice-roll-request-${mode}-to-${targetMode}`, {
      ...payload,
      eventId,
      mapId: activeMap.id,
      sourceMode: mode,
      updatedAt: Date.now(),
    })
  }

  const rollDiceBoxD20 = (label: string, targetName: string): Promise<number> => {
    const id = d20RequestCounterRef.current + 1
    d20RequestCounterRef.current = id
    const diceSeed = `${mode ?? 'local'}:${activeMap?.id ?? 'map'}:d20:${Date.now()}:${id}:${label}:${targetName}`
    const flyIndex = seededDieValue(`${diceSeed}:fly`, 8) - 1
    // T-P2-398 (398-A): decide the face up front so both ends @-relabel to the
    // same value. RNG moved from the iframe physics into JS — same uniform
    // distribution, now broadcastable.
    const value = 1 + Math.floor(Math.random() * 20)
    const rollRequestId = `${mode ?? 'local'}:${activeMap?.id ?? 'map'}:rr-d20:${Date.now()}:${id}`
    publishDiceStream({
      type: 'start',
      requestId: diceSeed,
      kind: 'd20',
      count: 1,
      sides: 20,
      diceSeed,
      flyIndex,
      label,
      targetName,
    })
    publishRollRequest({ requestId: rollRequestId, kind: 'd20', count: 1, sides: 20, values: [value], label, targetName })
    return new Promise((resolve) => {
      setDiceBoxD20({ id, label, targetName, value, diceSeed, animationSeed: diceSeed, flyIndex, resolve })
    })
  }

  const rollDiceBoxValues = (
    count: number,
    sides: number,
    label: string,
    targetName: string,
  ): Promise<number[]> => {
    const id = diceBoxRollRequestCounterRef.current + 1
    diceBoxRollRequestCounterRef.current = id
    const safeCount = Math.max(1, Math.min(12, Math.round(count)))
    const safeSides = Math.max(2, Math.min(100, Math.round(sides)))
    const diceSeed = `${mode ?? 'local'}:${activeMap?.id ?? 'map'}:dice:${Date.now()}:${id}:${safeCount}d${safeSides}:${label}:${targetName}`
    const flyIndex = seededDieValue(`${diceSeed}:fly`, 8) - 1
    const animationSeed = diceSeed
    // T-P2-398 (398-A): decide faces up front (see rollDiceBoxD20) and broadcast.
    const values = Array.from({ length: safeCount }, () => 1 + Math.floor(Math.random() * safeSides))
    const rollRequestId = `${mode ?? 'local'}:${activeMap?.id ?? 'map'}:rr-dice:${Date.now()}:${id}`
    publishDiceStream({
      type: 'start',
      requestId: animationSeed,
      kind: 'dice',
      count: safeCount,
      sides: safeSides,
      diceSeed,
      flyIndex,
      label,
      targetName,
    })
    publishRollRequest({ requestId: rollRequestId, kind: 'dice', count: safeCount, sides: safeSides, values, label, targetName })
    return new Promise((resolve) => {
      setDiceBoxRoll({ id, count: safeCount, sides: safeSides, label, targetName, values, animationSeed, flyIndex, resolve })
    })
  }

  const publishSharedDiceRoll = (roll: DiceRoll) => {
    if (!activeMap || !mode) return
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    seenSharedDiceIdsRef.current.add(id)
    const event: SharedDiceState = {
      id,
      mapId: activeMap.id,
      sourceMode: mode,
      status: 'result',
      roll,
      updatedAt: Date.now(),
    }
    publishSharedDiceEvent(event)
    void saveSharedResource<SharedDiceState>('dice', event)
  }

  useEffect(() => {
    initiativeOrderRef.current = initiativeOrder
  }, [initiativeOrder])

  const publishCombatState = (
    patch?: Partial<Omit<SharedCombatState, 'mapId' | 'updatedAt'>>,
  ) => {
    if (!activeMap) return
    const state: SharedCombatState = {
      mapId: activeMap.id,
      active: combatActive,
      round,
      initiativeIndex,
      initiativeOrder,
      enemyApByToken: enemyApByTokenRef.current,
      updatedAt: Date.now(),
      ...patch,
    }
    void saveSharedResource('combat', state)
  }

  const applySharedCombatState = (state: SharedCombatState | null) => {
    if (!state || !activeMap || state.mapId !== activeMap.id) return
    const snapshot = JSON.stringify(state)
    if (snapshot === lastSharedCombatSnapshot) return
    lastSharedCombatSnapshot = snapshot
    applyingSharedCombatRef.current = true
    setCombatActive(state.active)
    setRound(state.round)
    setInitiativeOrder(state.initiativeOrder)
    initiativeOrderRef.current = state.initiativeOrder
    setInitiativeIndex(state.initiativeIndex)
    initiativeIndexRef.current = state.initiativeIndex
    if (state.enemyApByToken) {
      enemyApByTokenRef.current = state.enemyApByToken
      setEnemyApByToken(state.enemyApByToken)
    }
    window.setTimeout(() => {
      applyingSharedCombatRef.current = false
    }, 0)
  }

  const startResizeWidth = (e: React.MouseEvent) => {
    e.preventDefault()
    setPanelFull(false)
    const frame = frameRef.current
    const rect = frame?.getBoundingClientRect()
    const leftEdge = (rect?.left ?? 0) + 88
    const maxW = (frame?.clientWidth ?? 1000) - 64 - 8
    const onMove = (ev: MouseEvent) => {
      setPanelWidth(Math.max(320, Math.min(maxW, ev.clientX - leftEdge)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startResizeHeight = (e: React.MouseEvent) => {
    e.preventDefault()
    const frame = frameRef.current
    const rect = frame?.getBoundingClientRect()
    const maxH = (rect?.height ?? 600) - 24
    const startY = e.clientY
    const startH = panelFull ? (rect?.height ?? 600) * 0.58 : panelHeight
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY
      const next = Math.max(160, Math.min(maxH, startH + delta))
      if (panelFull) {
        setPanelFull(false)
        setPanelHeight(next)
      } else {
        setPanelHeight(next)
      }
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const isDM = mode === 'dm'
  const forcedMode = modeFromPort()
  const activeMap = maps.find((m) => m.id === selectedId) ?? maps[0] ?? null
  const selectedToken = activeMap?.tokens.find((t) => t.id === selectedTokenId) ?? null
  const selectedCharacterToken = activeMap?.tokens.find((t) => t.id === selectedCharacterTokenId) ?? null
  const activeChar = characters.find((c) => c.id === activeCharId) ?? null

  const resetRoundApForActiveMap = (reason: string) => {
    if (!activeMap) return useCharacterStore.getState().characters
    const charIds = new Set(
      activeMap.tokens
        .map((token) => token.characterId)
        .filter((id): id is string => !!id),
    )
    if (charIds.size === 0) return useCharacterStore.getState().characters
    const characterState = useCharacterStore.getState()
    let changed = false
    const nextCharacters = characterState.characters.map((ch) => {
      if (!charIds.has(ch.id)) return ch
      if (ch.currentAP === ch.actionPoints) return ch
      changed = true
      return { ...ch, currentAP: ch.actionPoints }
    })
    if (changed) {
      console.info('[combat-ap-reset]', { reason, round, mapId: activeMap.id })
      useCharacterStore.setState({ characters: nextCharacters })
      void saveSharedResource('characters', {
        characters: nextCharacters,
        selectedId: characterState.selectedId,
        updatedAt: Date.now(),
      })
    }
    return nextCharacters
  }

  useEffect(() => {
    if (!combatActive || !activeMap || initiativeOrder.length === 0 || initiativeIndex !== 0) return
    const key = `${activeMap.id}:${round}`
    if (roundApResetKeysRef.current.has(key)) return
    roundApResetKeysRef.current.add(key)
    resetRoundApForActiveMap('round-start')
    const timer = window.setTimeout(() => {
      resetRoundApForActiveMap('round-start-confirm')
    }, 250)
    return () => window.clearTimeout(timer)
  }, [activeMap, combatActive, initiativeIndex, initiativeOrder.length, round])

  useEffect(() => {
    if (!activeMap) return
    let cancelled = false
    const load = async () => {
      if (cancelled) return
      await useMapStore.getState().loadShared()
    }
    void load()
    const timer = window.setInterval(load, 500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeMap?.id])

  useEffect(() => {
    if (!activeMap) return
    let cancelled = false
    const load = async () => {
      const state = await loadSharedResource<SharedCombatState>('combat')
      if (!cancelled) applySharedCombatState(state)
    }
    void load()
    const timer = window.setInterval(load, 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeMap?.id])

  useEffect(() => {
    if (!activeMap || !mode) return
    const sourceMode = mode === 'dm' ? 'player' : 'dm'
    const unsubscribe = subscribeSharedEvent<SharedDiceStreamEvent>(`dice-stream-${sourceMode}-to-${mode}`, (event) => {
      if (
        !event ||
        event.mapId !== activeMap.id ||
        event.sourceMode === mode ||
        Date.now() - event.updatedAt > 60000 ||
        seenDiceStreamEventIdsRef.current.has(event.eventId)
      ) {
        return
      }
      seenDiceStreamEventIdsRef.current.add(event.eventId)
      if (seenDiceStreamEventIdsRef.current.size > 1200) {
        seenDiceStreamEventIdsRef.current = new Set([...seenDiceStreamEventIdsRef.current].slice(-600))
      }

      if (event.type === 'start') {
        const pending = {
          diceSeed: event.diceSeed,
          flyIndex: event.flyIndex,
          kind: event.kind,
          count: Math.max(1, Math.round(event.count ?? 1)),
          sides: Math.max(2, Math.round(event.sides ?? (event.kind === 'd20' ? 20 : 6))),
          values: event.values,
          label: event.label,
          targetName: event.targetName,
        }
        pendingDiceStreamsRef.current.set(event.requestId, pending)
        return
      }

      if (event.type === 'frame') {
        const pending =
          pendingDiceStreamsRef.current.get(event.requestId) ?? {
            diceSeed: event.requestId,
            kind: event.kind,
            count: 1,
            sides: event.kind === 'd20' ? 20 : 6,
            label: 'D20',
            targetName: '',
          }
        pending.firstFrame = event.frame
        pending.firstFrameSeq = event.index
        pendingDiceStreamsRef.current.set(event.requestId, pending)
        setSharedDicePreview((current) => {
          if (current?.id === event.requestId) {
            return {
              ...current,
              traceFrames: [...(current.traceFrames ?? []), event.frame].slice(-900),
              replayLive: true,
              liveFrame: event.frame,
              liveFrameSeq: event.index,
            }
          }
          return {
            id: event.requestId,
            kind: pending.kind,
            count: pending.count,
            sides: pending.sides,
            values: pending.values,
            diceSeed: pending.diceSeed ?? event.requestId,
            traceFrames: [event.frame],
            replayLive: true,
            liveFrame: event.frame,
            liveFrameSeq: event.index,
            animationSeed: event.requestId,
            flyIndex: pending.flyIndex,
            label: pending.label,
            targetName: pending.targetName,
          }
        })
        return
      }

      if (event.type === 'complete') {
        pendingDiceStreamsRef.current.delete(event.requestId)
        if (event.kind === 'd20') {
          window.setTimeout(() => {
            setSharedDicePreview((current) => (current?.id === event.requestId ? null : current))
          }, 600)
        }
      }
    })
    return unsubscribe
  }, [activeMap?.id, mode])

  // T-P2-398 (398-A): subscribe to the result-broadcast channel and self-render
  // the decided @values locally. Isolated from the old dice-stream handler
  // above; the only state it touches is rollRequestPreview.
  useEffect(() => {
    if (!activeMap || !mode) return
    const sourceMode = mode === 'dm' ? 'player' : 'dm'
    const unsubscribe = subscribeSharedEvent<SharedRollRequestEvent>(
      `dice-roll-request-${sourceMode}-to-${mode}`,
      (event) => {
        if (
          !event ||
          event.mapId !== activeMap.id ||
          event.sourceMode === mode ||
          Date.now() - event.updatedAt > 60000 ||
          seenRollRequestIdsRef.current.has(event.requestId)
        ) {
          return
        }
        seenRollRequestIdsRef.current.add(event.requestId)
        if (seenRollRequestIdsRef.current.size > 600) {
          seenRollRequestIdsRef.current = new Set([...seenRollRequestIdsRef.current].slice(-300))
        }
        setRollRequestPreview({
          id: event.requestId,
          kind: event.kind,
          count: Math.max(1, Math.round(event.count)),
          sides: Math.max(2, Math.round(event.sides)),
          values: Array.isArray(event.values) ? event.values : [],
          label: event.label,
          targetName: event.targetName,
        })
      },
    )
    return unsubscribe
  }, [activeMap?.id, mode])

  useEffect(() => {
    if (!activeMap || !mode) return
    let cancelled = false
    const applyDiceEvent = (state: SharedDiceState) => {
      if (
        cancelled ||
        !state ||
        state.mapId !== activeMap.id ||
        state.sourceMode === mode ||
        Date.now() - state.updatedAt > 60000
      ) {
        return
      }
      if (state.status === 'rolling') {
        return
      }
      if (seenSharedDiceIdsRef.current.has(state.id) || !state.roll) return
      seenSharedDiceIdsRef.current.add(state.id)
      setRoll({ ...state.roll, diceBoxResolved: true })
    }
    const load = async () => {
      const eventState = await loadSharedResource<SharedDiceEventsState>('dice-events')
      if (!cancelled && eventState?.mapId === activeMap.id) {
        for (const event of eventState.events ?? []) applyDiceEvent(event)
        return
      }
      const state = await loadSharedResource<SharedDiceState>('dice')
      if (state) applyDiceEvent(state)
    }
    void load()
    const timer = window.setInterval(load, 500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeMap?.id, mode])

  useEffect(() => {
    if (!activeMap) return
    let cancelled = false
    const load = async () => {
      const state = await loadSharedResource<SharedCombatLogState>('combat-log')
      if (cancelled || !state || state.mapId !== activeMap.id) return
      const incoming = (state.entries ?? []).filter((entry) => !seenSharedLogIdsRef.current.has(entry.id))
      if (incoming.length === 0) return
      for (const entry of incoming) seenSharedLogIdsRef.current.add(entry.id)
      setCombatLog((current) => {
        const merged = [...incoming, ...current]
        const unique = new Map<number, CombatLogEntry>()
        for (const entry of merged) unique.set(entry.id, entry)
        return [...unique.values()]
          .sort((a, b) => b.id - a.id)
          .slice(0, 80)
      })
    }
    void load()
    const timer = window.setInterval(load, 500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeMap?.id])

  useEffect(() => {
    if (!activeMap || applyingSharedCombatRef.current) return
    if (!combatActive && initiativeOrder.length === 0) return
    publishCombatState()
  }, [activeMap?.id, combatActive, round, initiativeIndex, initiativeOrder, enemyApByToken])

  const chooseMode = (next: Mode) => {
    if (forcedMode && next !== forcedMode) return
    window.localStorage.setItem('stars-map-role', next)
    setMode(next)
    setSelectedTokenId(null)
    closeCharDock()
  }

  useEffect(() => {
    if (forcedMode && mode !== forcedMode) setMode(forcedMode)
  }, [forcedMode, mode])

  const currentInitiativeToken =
    combatActive && initiativeOrder.length > 0
      ? activeMap?.tokens.find((t) => t.id === initiativeOrder[initiativeIndex]?.tokenId)
      : undefined
  const isEnemyTurn =
    currentInitiativeToken?.type === 'enemy' &&
    !!currentInitiativeToken &&
    isTokenAlive(currentInitiativeToken, characters)

  const linkedIds = new Set((activeMap?.tokens ?? []).map((t) => t.characterId).filter(Boolean) as string[])
  const linkedPlayerChars = (activeMap?.tokens ?? [])
    .filter((t) => t.type === 'player' && t.characterId)
    .map((t) => characters.find((c) => c.id === t.characterId))
    .filter((c): c is Character => !!c)
  const playerVisibleChars = playerViewCharacters(characters)
  const visibleChars = isDM ? [] : (playerVisibleChars.length > 0 ? playerVisibleChars : linkedPlayerChars)
  const railChars =
    visibleChars.filter((c) => linkedIds.has(c.id)).length > 0
      ? visibleChars.filter((c) => linkedIds.has(c.id))
      : visibleChars

  const closeCharDock = () => {
    setActiveCharId(null)
    setCharPanel(null)
  }

  const clearPlayerCombatUI = () => {
    setShowMoveRange(false)
  }

  const turnCharacter =
    combatActive && currentInitiativeToken?.characterId
      ? characters.find((c) => c.id === currentInitiativeToken.characterId)
      : undefined

  const playerChar = getPlayerCharacter(characters) ?? visibleChars[0]

  useEffect(() => {
    if (!activeMap) return
    let cancelled = false
    const load = async () => {
      const state = await loadSharedResource<SharedDodgeState>('dodge')
      if (cancelled || !state || state.mapId !== activeMap.id) return
      if (suppressedDodgePromptIdsRef.current.has(state.id)) return
      if (isDM) {
        const pending = pendingSharedDodgeRef.current
        if (pending && state.id === pending.id && state.status === 'answered') {
          pendingSharedDodgeRef.current = null
          await saveSharedResource('dodge', { ...state, status: 'done', updatedAt: Date.now() })
          const targetChar = useCharacterStore.getState().characters.find((c) => c.id === pending.targetCharId)
          if (targetChar) {
            void finishEnemyAttack(
              pending.result,
              targetChar,
              !!state.wantsDodge,
              state.dodgeD20,
              !!state.dodgeApSpent,
            ).then(pending.onComplete)
          } else {
            pending.onComplete()
          }
        }
        return
      }
      if (state.status !== 'pending') {
        setSharedDodgePrompt((current) => (current?.id === state.id ? null : current))
        return
      }
      const targetChar = characters.find((c) => c.id === state.targetCharId)
      const canAnswer =
        !!targetChar &&
        targetChar.currentHp > 0 &&
        (targetChar.id === playerChar?.id ||
          visibleChars.some((c) => c.id === targetChar.id) ||
          !targetChar.dmNotes)
      if (canAnswer) setSharedDodgePrompt({ id: state.id, result: state.result, targetChar })
    }
    void load()
    const timer = window.setInterval(load, 500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeMap?.id, isDM, characters, playerChar?.id, visibleChars])

  const canControlPlayerTurn =
    combatActive &&
    currentInitiativeToken?.type === 'player' &&
    !!turnCharacter &&
    turnCharacter.currentHp > 0 &&
    !!currentInitiativeToken &&
    isTokenAlive(currentInitiativeToken, characters) &&
    (isDM || turnCharacter.id === playerChar?.id)

  const myPlayerToken =
    activeMap && turnCharacter
      ? activeMap.tokens.find((t) => t.type === 'player' && t.characterId === turnCharacter.id)
      : undefined

  const agileLeapChar = useMemo(
    () => characters.find((c) => (c.combatBuffs?.agileLeapMoveFeet ?? 0) > 0),
    [characters],
  )

  const agileLeapToken = useMemo(() => {
    if (!agileLeapChar || !activeMap) return undefined
    return activeMap.tokens.find((t) => t.characterId === agileLeapChar.id)
  }, [agileLeapChar, activeMap])

  const canAgileLeapMove =
    !!agileLeapChar &&
    !!agileLeapToken &&
    (isDM || agileLeapChar.id === playerChar?.id)

  const moveCircle = useMemo(() => {
    if (!showMoveRange || !activeMap || !myPlayerToken || !turnCharacter) return undefined
    const feet = turnCharacter.speed
    return {
      centerX: myPlayerToken.x,
      centerY: myPlayerToken.y,
      radiusPx: movementRadiusPx(feet, activeMap),
    }
  }, [showMoveRange, activeMap, myPlayerToken, turnCharacter])

  const agileLeapCircle = useMemo(() => {
    if (!canAgileLeapMove || !agileLeapChar || !agileLeapToken || !activeMap) return undefined
    const feet = agileLeapChar.combatBuffs!.agileLeapMoveFeet!
    return {
      centerX: agileLeapToken.x,
      centerY: agileLeapToken.y,
      radiusPx: movementRadiusPx(feet, activeMap),
    }
  }, [canAgileLeapMove, agileLeapChar, agileLeapToken, activeMap])

  const calmSpiritMoveCircle = useMemo(() => {
    if (!activeMap || !myPlayerToken || !turnCharacter) return undefined
    const feet = turnCharacter.combatBuffs?.calmSpiritMoveFeet ?? 0
    if (feet <= 0) return undefined
    return {
      centerX: myPlayerToken.x,
      centerY: myPlayerToken.y,
      radiusPx: movementRadiusPx(feet, activeMap),
    }
  }, [activeMap, myPlayerToken, turnCharacter])

  const freeMoveCircle = useMemo(() => {
    if (!activeMap || !myPlayerToken || !turnCharacter) return undefined
    const feet = turnCharacter.combatBuffs?.freeMoveFeet ?? 0
    if (feet <= 0) return undefined
    return {
      centerX: myPlayerToken.x,
      centerY: myPlayerToken.y,
      radiusPx: movementRadiusPx(feet, activeMap),
    }
  }, [activeMap, myPlayerToken, turnCharacter])

  const activeMoveCircle = agileLeapCircle ?? calmSpiritMoveCircle ?? freeMoveCircle ?? moveCircle
  const inMoveSelectMode =
    !!agileLeapCircle ||
    !!calmSpiritMoveCircle ||
    !!freeMoveCircle ||
    (canControlPlayerTurn && showMoveRange && !!moveCircle && !targeting?.aoe)

  const onAvatarClick = (charId: string) => {
    if (activeCharId === charId && !charPanel) {
      setActiveCharId(null)
      return
    }
    setActiveCharId(charId)
  }

  useEffect(() => {
    if (isDM) return
    const mine = playerChar
    if (!mine) {
      if (activeCharId) {
        setActiveCharId(null)
        setCharPanel(null)
      }
      return
    }
    if (activeCharId && activeCharId !== mine.id) {
      setActiveCharId(null)
      setCharPanel(null)
    }
  }, [isDM, playerChar?.id, activeCharId])

  const onPanelClick = (charId: string, panel: CharDockPanel) => {
    if (activeCharId === charId && charPanel === panel) {
      closeCharDock()
      return
    }
    setActiveCharId(charId)
    setCharPanel(panel)
  }

  // 每个 token 的生命值（角色取关联角色 HP，否则取 token 自身 HP）
  const tokenHp = (t: Token): { hp: number; max: number; temp?: number } | undefined => {
    if (t.characterId) {
      const ch = characters.find((c) => c.id === t.characterId)
      if (ch) return { hp: ch.currentHp, max: ch.maxHp, temp: ch.tempHp ?? 0 }
    }
    if (t.maxHp != null) return { hp: t.hp ?? t.maxHp, max: t.maxHp }
    return undefined
  }
  const hpByToken: Record<string, { hp: number; max: number; temp?: number }> = {}
  for (const t of activeMap?.tokens ?? []) {
    const h = tokenHp(t)
    if (h) hpByToken[t.id] = h
  }
  const apByToken: Record<string, { current: number; max: number }> = {}
  for (const t of activeMap?.tokens ?? []) {
    if (t.type === 'enemy') {
      apByToken[t.id] = enemyApByToken[t.id] ?? { current: 2, max: 2 }
      continue
    }
    if (t.characterId) {
      const ch = characters.find((c) => c.id === t.characterId)
      if (ch) {
        apByToken[t.id] = { current: ch.currentAP, max: ch.actionPoints }
        continue
      }
    }
  }

  const characterHpKey = characters.map((c) => `${c.id}:${c.currentHp}:${c.tempHp ?? 0}`).join('|')
  const tokenHpKey = (activeMap?.tokens ?? []).map((t) => `${t.id}:${t.hp ?? ''}`).join('|')

  const defeatedTokenIds = useMemo(() => {
    if (!activeMap) return [] as string[]
    return activeMap.tokens
      .filter((t) => isTokenDefeated(t, characters, hpByToken[t.id]))
      .map((t) => t.id)
  }, [activeMap?.tokens, characterHpKey, tokenHpKey, characters])

  const aoeCasterCell = useMemo((): GridCell | null => {
    if (!activeMap || !targeting) return null
    const casterToken = activeMap.tokens.find((t) => t.characterId === targeting.casterId)
    if (!casterToken) return null
    return pixelToCell(casterToken.x, casterToken.y, activeMap)
  }, [activeMap, targeting])

  const aoeOrientFromCell = (aoe: SkillAoeTargeting, casterCell: GridCell, anchorCell: GridCell): GridCell => {
    if (aoe.shape !== 'rect' || targeting?.skill.skillTreeId !== 'arrowStorm') return casterCell
    const dir = [
      { col: 0, row: -1 },
      { col: 1, row: 0 },
      { col: 0, row: 1 },
      { col: -1, row: 0 },
    ][((aoeRectRotation % 4) + 4) % 4]
    return { col: anchorCell.col - dir.col, row: anchorCell.row - dir.row }
  }

  const aoeHighlight = useMemo(() => {
    if (!targeting?.aoe || !aoePreviewCell || !aoeCasterCell || !activeMap) return undefined
    const valid = canPlaceAoe(targeting.aoe, aoeCasterCell, aoePreviewCell)
    const orientFrom = aoeOrientFromCell(targeting.aoe, aoeCasterCell, aoePreviewCell)
    const cells = cellsForAoe(targeting.aoe, orientFrom, aoePreviewCell)
    const isSelfCircle =
      targeting.aoe.shape === 'circle' && targeting.aoe.origin === 'self'
    const rangeCells =
      targeting.aoe.shape === 'circle' && targeting.aoe.origin === 'point' && targeting.aoe.placeRangeFeet != null
        ? cellsForAoe(
            { shape: 'circle', origin: 'self', radiusFeet: targeting.aoe.placeRangeFeet },
            aoeCasterCell,
            aoeCasterCell,
          )
        : targeting.aoe.shape === 'rect' && targeting.aoe.placeRangeFeet != null
          ? cellsForAoe(
              { shape: 'circle', origin: 'self', radiusFeet: targeting.aoe.placeRangeFeet },
              aoeCasterCell,
              aoeCasterCell,
            )
          : undefined
    const cellCenterToPixel = (cell: GridCell) => ({
      x: activeMap.gridOffsetX + (cell.col + 0.5) * activeMap.gridSize,
      y: activeMap.gridOffsetY + (cell.row + 0.5) * activeMap.gridSize,
    })
    const areaCenterCell = isSelfCircle ? aoeCasterCell : aoePreviewCell
    const areaCenter = cellCenterToPixel(areaCenterCell)
    const areaCircle =
      targeting.aoe.shape === 'circle'
        ? {
            centerX: areaCenter.x,
            centerY: areaCenter.y,
            radiusPx: movementRadiusPx(targeting.aoe.radiusFeet, activeMap),
          }
        : undefined
    const areaPolygon = (() => {
      const aoe = targeting.aoe
      if (aoe.shape === 'circle') return undefined
      const origin = cellCenterToPixel(aoe.shape === 'line' ? aoeCasterCell : aoePreviewCell)
      const aim =
        aoe.shape === 'line'
          ? cellCenterToPixel(aoePreviewCell)
          : cellCenterToPixel({
              col: aoePreviewCell.col * 2 - orientFrom.col,
              row: aoePreviewCell.row * 2 - orientFrom.row,
            })
      const dx = aim.x - origin.x
      const dy = aim.y - origin.y
      const len = Math.hypot(dx, dy) || 1
      const ux = dx / len
      const uy = dy / len
      const px = -uy
      const py = ux
      const w = aoe.widthFeet / 5 * activeMap.gridSize
      const h = (aoe.shape === 'line' ? aoe.lengthFeet : aoe.heightFeet) / 5 * activeMap.gridSize
      if (aoe.shape === 'line') {
        const start = origin
        const end = { x: origin.x + ux * h, y: origin.y + uy * h }
        return [
          start.x + px * w / 2, start.y + py * w / 2,
          end.x + px * w / 2, end.y + py * w / 2,
          end.x - px * w / 2, end.y - py * w / 2,
          start.x - px * w / 2, start.y - py * w / 2,
        ]
      }
      return [
        origin.x - ux * h / 2 + px * w / 2, origin.y - uy * h / 2 + py * w / 2,
        origin.x + ux * h / 2 + px * w / 2, origin.y + uy * h / 2 + py * w / 2,
        origin.x + ux * h / 2 - px * w / 2, origin.y + uy * h / 2 - py * w / 2,
        origin.x - ux * h / 2 - px * w / 2, origin.y - uy * h / 2 - py * w / 2,
      ]
    })()
    return {
      cells,
      rangeCells,
      valid,
      variant: isSelfCircle ? ('range' as const) : ('attack' as const),
      areaCircle,
      areaPolygon,
    }
  }, [targeting, aoePreviewCell, aoeCasterCell, activeMap, aoeRectRotation])

  const rangedRangeCells = useMemo(() => {
    if (!targeting || targeting.aoe || !activeMap) return [] as GridCell[]
    const rangeFeet = singleTargetRangeFeet(targeting.skill)
    if (rangeFeet == null) return [] as GridCell[]
    const casterToken = activeMap.tokens.find((t) => t.characterId === targeting.casterId)
    if (!casterToken) return [] as GridCell[]
    const casterCell = pixelToCell(casterToken.x, casterToken.y, activeMap)
    return cellsForAoe(
      { shape: 'circle', origin: 'self', radiusFeet: rangeFeet },
      casterCell,
      casterCell,
    )
  }, [targeting, activeMap])

  useEffect(() => {
    if (!targeting?.aoe || !aoeCasterCell) {
      if (!targeting?.aoe) setAoePreviewCell(null)
      return
    }
    setAoePreviewCell(aoeCasterCell)
  }, [targeting?.aoe, targeting?.casterId, aoeCasterCell])

  useEffect(() => {
    if (targeting?.aoe?.shape !== 'rect' || targeting.skill.skillTreeId !== 'arrowStorm') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'q') {
        e.preventDefault()
        setAoeRectRotation((r) => (r + 3) % 4)
      } else if (e.key.toLowerCase() === 'e') {
        e.preventDefault()
        setAoeRectRotation((r) => (r + 1) % 4)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [targeting])

  const tokenBadges = useMemo(() => {
    const badges: Record<
      string,
      {
        doubleArrow?: boolean
        eagleEye?: boolean
        silentDraw?: boolean
        preciseStrike?: boolean
        calmMind?: boolean
        calmSpiritStacks?: number
        outOfBreath?: boolean
        huntingMarkStacks?: number
      }
    > = {}
    for (const t of activeMap?.tokens ?? []) {
      const entry: (typeof badges)[string] = {}
      if ((t.huntingMarkStacks ?? 0) > 0) entry.huntingMarkStacks = t.huntingMarkStacks
      if (t.characterId) {
        const ch = characters.find((c) => c.id === t.characterId)
        if (ch) {
          if (ch.combatBuffs?.doubleArrowReady && findClassTrait(ch, 'doubleArrow')) {
            entry.doubleArrow = true
          }
          if ((ch.combatBuffs?.eagleEyeTurns ?? 0) > 0 && findClassTrait(ch, 'eagleEye')) {
            entry.eagleEye = true
          }
          if (
            combatActive &&
            round === 1 &&
            initiativeOrder[0]?.tokenId === t.id &&
            findClassTrait(ch, 'silentDraw') &&
            !ch.combatBuffs?.silentDrawUsed
          ) {
            entry.silentDraw = true
          }
          if (ch.combatBuffs?.preciseStrikeReady && findClassTrait(ch, 'preciseStrike')) {
            entry.preciseStrike = true
          }
          if ((ch.combatBuffs?.calmSpiritStacks ?? 0) > 0) {
            entry.calmSpiritStacks = ch.combatBuffs?.calmSpiritStacks
          }
          if (findClassTrait(ch, 'calmMind')) {
            if (isCalmMindActive(ch)) entry.calmMind = true
            else if (isOutOfBreath(ch)) entry.outOfBreath = true
          }
        }
      }
      if (Object.keys(entry).length > 0) badges[t.id] = entry
    }
    return badges
  }, [activeMap?.tokens, characters, combatActive, initiativeOrder, round])

  const tokenHoverLabels = useMemo(() => {
    if (!targeting || targeting.aoe || !activeMap) return {}
    const caster = characters.find((c) => c.id === targeting.casterId)
    if (!caster || targeting.skill.damageCount <= 0) return {}
    const attackerInput = characterToCombatInput(caster)
    const damageType = isMagicDamageSkill(targeting.skill) ? 'magic' : 'physical'
    const labels: Record<string, string> = {}
    for (const token of activeMap.tokens) {
      if (token.characterId === targeting.casterId) continue
      if (!isTokenAlive(token, characters)) continue
      const targetChar = token.characterId
        ? characters.find((c) => c.id === token.characterId)
        : undefined
      const defenderInput = targetChar
        ? characterToCombatInput(targetChar)
        : token.poolId
          ? enemyCombatInput(token.poolId)
          : undefined
      const modifier = defenderInput
        ? damageModifierFromAttackDefenseDiff(
            getAttackDefenseDiff(attackerInput, defenderInput, damageType),
          )
        : 0
      labels[token.id] = `伤害 ${modifier >= 0 ? '+' : ''}${modifier}`
    }
    return labels
  }, [activeMap, characters, targeting])

  const launchArrowProjectile = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    kind: MapProjectile['kind'] = 'arrow',
  ) => {
    const id = `${kind ?? 'arrow'}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setProjectiles((current) => [...current, { id, from, to, kind }])
    window.setTimeout(() => {
      setProjectiles((current) => current.filter((p) => p.id !== id))
    }, kind === 'focus' ? 980 : 620)
  }

  const clearStatusesOnDeath = (tokenId: string, charId?: string) => {
    if (!activeMap) return
    updateToken(activeMap.id, tokenId, TOKEN_STATUS_CLEAR_PATCH)
    if (charId) updateChar(charId, { conditions: [] })
  }

  const deferDeathHandling = (tokenId: string, charId?: string) => {
    const key = `${tokenId}:${charId ?? ''}`
    if (pendingDeathKeysRef.current.has(key)) return
    pendingDeathKeysRef.current.add(key)
    afterRollCallbacksRef.current.push(() => {
      pendingDeathKeysRef.current.delete(key)
      clearStatusesOnDeath(tokenId, charId)
      tryEndCombatIfNeeded()
    })
  }

  type KnockbackPending = {
    tokenId: string
    tokenLabel: string
    targetCharId?: string
    casterId: string
    skill: CombatSkill
  }

  const handleRollDone = () => {
    setRoll(null)
    const callbacks = afterRollCallbacksRef.current
    afterRollCallbacksRef.current = []
    callbacks.forEach((callback) => callback())
    const next = afterRollRef.current
    afterRollRef.current = null
    next?.()
  }

  const applyKnockbackFromSave = (
    tokenId: string,
    targetCharId: string | undefined,
    caster: Character,
    casterId: string,
    save: KnockbackSaveResult,
  ) => {
    if (!activeMap || save.success) return
    updateToken(activeMap.id, tokenId, { knockbackTurns: KNOCKBACK_DEFAULT_TURNS })
    if (offerGaleCombo(caster, '击飞')) {
      updateChar(casterId, {
        combatBuffs: { ...caster.combatBuffs, galeComboReady: true },
      })
    }
    if (targetCharId) {
      const ch = useCharacterStore.getState().characters.find((c) => c.id === targetCharId)
      if (ch && !ch.conditions.includes(KNOCKBACK_STATUS_LABEL)) {
        updateChar(targetCharId, { conditions: [...ch.conditions, KNOCKBACK_STATUS_LABEL] })
      }
    }
  }

  const showKnockbackSaveRoll = (
    pending: KnockbackPending,
    index: number,
    queue: KnockbackPending[],
  ) => {
    if (!activeMap) return
    const caster = useCharacterStore.getState().characters.find((c) => c.id === pending.casterId)
    const token = activeMap.tokens.find((t) => t.id === pending.tokenId)
    if (!caster || !token) {
      if (index + 1 < queue.length) {
        afterRollRef.current = () => showKnockbackSaveRoll(queue[index + 1], index + 1, queue)
      }
      return
    }
    const targetChar = pending.targetCharId
      ? useCharacterStore.getState().characters.find((c) => c.id === pending.targetCharId)
      : undefined
    const save = resolveKnockbackSave(caster, token, targetChar, {
      disadvantage: pending.skill.knockbackSaveDisadvantage,
    })
    applyKnockbackFromSave(pending.tokenId, pending.targetCharId, caster, pending.casterId, save)
    const saveLabel = formatKnockbackSaveLabel(save)

    if (index + 1 < queue.length) {
      afterRollRef.current = () => showKnockbackSaveRoll(queue[index + 1], index + 1, queue)
    }

    setRoll({
      values: [],
      sides: 20,
      bonus: 0,
      total: 0,
      label: saveLabel,
      targetName: pending.tokenLabel,
      d20Roll: {
        value: save.saveD20,
        modifier: save.saveMod,
        ac: save.dc,
        hit: save.success,
        kind: 'save',
      },
    })
  }

  const scheduleKnockbackRolls = (queue: KnockbackPending[]) => {
    if (queue.length === 0) return
    afterRollRef.current = () => showKnockbackSaveRoll(queue[0], 0, queue)
  }

  const dexSaveDamageMode = (skillTreeId?: string): 'half' | 'none' | 'fail-half' | null => {
    if (skillTreeId === 'focusShot') return 'fail-half'
    if (skillTreeId === 'aerialCombo' || skillTreeId === 'arrowStorm' || skillTreeId === 'whirlwindKick') return 'half'
    if (skillTreeId === 'spiralBlade') return 'none'
    return null
  }

  const formatSkillDexSaveLabel = (
    save: KnockbackSaveResult,
    mode: 'half' | 'none' | 'fail-half',
  ) => {
    const roll =
      save.saveD20Second != null
        ? `（劣势 ${save.saveD20}/${save.saveD20Second}）`
        : ''
    const successText =
      mode === 'half' ? '成功，伤害减半' : mode === 'fail-half' ? '成功，全额伤害' : '成功，未受伤害'
    const failText =
      mode === 'half' ? '失败，全额伤害' : mode === 'fail-half' ? '失败，伤害减半' : '失败，受到伤害'
    return `敏捷豁免${roll} ${save.saveD20}+${save.saveMod} vs DC${save.dc} ${
      save.success ? successText : failText
    }`
  }

  const tokenHasKnockback = (token: Token, targetChar?: Character) =>
    (token.knockbackTurns ?? 0) > 0 ||
    !!targetChar?.conditions.includes(KNOCKBACK_STATUS_LABEL)

  const applySkillCooldownReduction = (charId: string, skillId: string, amount: number) => {
    if (amount <= 0) return
    const ch = useCharacterStore.getState().characters.find((c) => c.id === charId)
    if (!ch) return
    updateChar(charId, {
      combatSkills: ch.combatSkills.map((s) =>
        s.id === skillId ? { ...s, remaining: Math.max(0, s.remaining - amount) } : s,
      ),
    })
  }

  const addConditionToCharacter = (charId: string | undefined, label: string) => {
    if (!charId) return
    const ch = useCharacterStore.getState().characters.find((c) => c.id === charId)
    if (!ch || ch.conditions.includes(label)) return
    updateChar(charId, { conditions: [...ch.conditions, label] })
  }

  const chooseCooldownSkillToReduce = (caster: Character, amount: number, reason: string) => {
    const latest = useCharacterStore.getState().characters.find((c) => c.id === caster.id)
    if (!latest) return
    const skills = latest.combatSkills.filter((s) => s.remaining > 0)
    if (skills.length === 0) return
    const picked = window.prompt(
      `${reason}\n选择要 CD -${amount} 的技能编号：\n${skills
        .map((s, i) => `${i + 1}. ${s.name}（剩余 ${s.remaining}）`)
        .join('\n')}`,
    )
    const skill = skills[Number(picked) - 1]
    if (!skill) return
    applySkillCooldownReduction(latest.id, skill.id, amount)
    pushCombatLog(`${latest.name} 因 ${reason}：${skill.name} CD -${amount}`, 'turn')
  }

  const resolveAbilitySave = async (
    caster: Character,
    token: Token,
    targetChar: Character | undefined,
    ability: 'str' | 'dex' | 'con' | 'wis',
    label: string,
  ) => {
    const d20 = await rollDiceBoxD20(`${label} D20`, token.label)
    const saveMod = getTokenAbilityMod(token, ability, targetChar)
    const saveTotal = d20 + saveMod
    const success = saveTotal >= caster.saveDC
    return { d20, saveMod, saveTotal, dc: caster.saveDC, success }
  }

  const abilitySaveLabel = (
    label: string,
    save: { d20: number; saveMod: number; dc: number; success: boolean },
    successText: string,
    failText: string,
  ) => `${label} ${save.d20}+${save.saveMod} vs DC${save.dc} ${save.success ? successText : failText}`

  const chooseEnemyTokenByPrompt = (reason: string, filter?: (token: Token) => boolean): Token | null => {
    if (!activeMap) return null
    const candidates = activeMap.tokens.filter((t) => isEnemyTarget(t) && isTokenAlive(t, useCharacterStore.getState().characters) && (!filter || filter(t)))
    if (candidates.length === 0) {
      alert('没有可选目标')
      return null
    }
    const picked = window.prompt(
      `${reason}\n选择目标编号：\n${candidates
        .map((t, i) => `${i + 1}. ${t.label}${(t.huntingMarkStacks ?? 0) > 0 ? `（印记 ${t.huntingMarkStacks}）` : ''}`)
        .join('\n')}`,
    )
    return candidates[Number(picked) - 1] ?? null
  }

  const resolveEnemyAutoDodge = async (
    token: Token,
    attacker: Character | undefined,
    skill: CombatSkill,
    isAoeTarget?: boolean,
  ) => {
    if (!combatActive || !activeMap || !attacker || token.type !== 'enemy' || isAoeTarget) return null
    const ap = getEnemyApState(token.id)
    if (ap.current < 1) return null
    const attackAbility = skill.tags?.includes('melee') ? 'str' : 'dex'
    const attackBonus = getEffectiveAbilityMod(attacker, attackAbility) + proficiencyBonus(attacker.level)
    const targetAc = getTokenTargetAc(token) ?? 12
    const diceCount = attackDamageDiceCount(skill, false)
    const estimatedDamage = diceCount * ((skill.damageSides + 1) / 2) + (skill.damageBonus ?? 0)
    const decision = decideDodge({
      currentAp: ap.current,
      currentHp: token.hp ?? token.maxHp ?? 1,
      maxHp: token.maxHp ?? token.hp ?? 1,
      targetAc,
      incomingAttackBonus: attackBonus,
      estimatedDamage,
    })
    if (!decision.shouldDodge) {
      pushCombatLog(
        `${token.label} 保留AP：不闪避 ${skill.name}（${decision.reason}，成功率${Math.round(decision.successChance * 100)}%，预估伤害${Math.round(estimatedDamage)}）`,
        'turn',
      )
      return null
    }
    if (!spendEnemyAp(token.id, 1)) return null
    const d20 = await rollDiceBoxD20('敌人闪避 D20', token.label)
    const total = d20 + attackBonus
    const dodged = total < targetAc
    pushCombatLog(
      `${token.label} 花费 1 AP：尝试闪避 ${skill.name}。判定 ${d20}+${attackBonus}=${total} vs AC ${targetAc}，${dodged ? '闪避成功' : '闪避失败'}`,
      dodged ? 'attack' : 'turn',
    )
    return { dodged, d20, attackBonus, total, targetAc }
  }

  const findArmorPiercingTargets = (
    casterToken: Token,
    primaryTarget: Token,
    splashDamage: number,
  ): Token[] => {
    if (!activeMap || splashDamage <= 0) return []
    const dx = primaryTarget.x - casterToken.x
    const dy = primaryTarget.y - casterToken.y
    const len = Math.hypot(dx, dy)
    if (len < 1) return []
    const ux = dx / len
    const uy = dy / len
    const rangePx = (15 / DND_FEET_PER_CELL) * Math.max(1, activeMap.gridSize)
    const halfWidthPx = Math.max(6, activeMap.gridSize * 0.5)
    return activeMap.tokens.filter((t) => {
      if (t.id === casterToken.id || t.id === primaryTarget.id) return false
      if (!isEnemyTarget(t)) return false
      if (!isTokenAlive(t, characters)) return false
      const tx = t.x - primaryTarget.x
      const ty = t.y - primaryTarget.y
      const forward = tx * ux + ty * uy
      if (forward <= 0 || forward > rangePx) return false
      const perpendicular = Math.abs(tx * -uy + ty * ux)
      return perpendicular <= halfWidthPx
    })
  }

  const applyDirectFeatureDamage = (token: Token, amount: number, label: string) => {
    if (!activeMap || amount <= 0) return
    if (token.characterId) {
      damageChar(token.characterId, amount)
      const updated = useCharacterStore.getState().characters.find((c) => c.id === token.characterId)
      updateToken(activeMap.id, token.id, {
        hp: updated?.currentHp,
        maxHp: updated?.maxHp,
      })
      if (updated && updated.currentHp <= 0) deferDeathHandling(token.id, token.characterId)
    } else if (token.maxHp != null) {
      const hp = Math.max(0, (token.hp ?? token.maxHp) - amount)
      updateToken(activeMap.id, token.id, { hp })
      if (hp <= 0) deferDeathHandling(token.id)
    }
    pushCombatLog(`${label} 对 ${token.label} 造成 ${amount} 点伤害`, 'damage')
  }

  const moveTokenByCells = (token: Token, dx: number, dy: number, cells: number) => {
    if (!activeMap || cells <= 0) return
    const from = pixelToCell(token.x, token.y, activeMap)
    const len = Math.hypot(dx, dy) || 1
    const to = {
      col: from.col + Math.round((dx / len) * cells),
      row: from.row + Math.round((dy / len) * cells),
    }
    updateToken(activeMap.id, token.id, cellToPixel(to, activeMap))
  }

  const eagleStrikeExtraDiceCount = (rank: number) => {
    if (rank <= 0) return 0
    return rank === 1 ? 3 : 4
  }

  const windTraceExtraDiceCount = (
    skillTreeId: string | undefined,
    rank: number,
    caster: Character,
    token: Token,
    aoeTargetCount?: number,
  ) => {
    if (skillTreeId !== 'windTraceShot') return 0
    let count = 0
    if ((aoeTargetCount ?? 0) === 1) count += 2
    if (rank >= 2 && isCalmMindActive(caster)) count += 1
    if (rank >= 3) count += token.huntingMarkStacks ?? 0
    return count
  }

  const huntingMarkTraitRank = (caster?: Character) =>
    caster ? (findClassTrait(caster, 'huntingMark')?.level ?? 0) : 0

  const triggerFinaleIfReady = async (caster: Character | undefined, target: Token) => {
    if (!activeMap || !caster?.combatBuffs?.finaleReady) return false
    const trait = findClassTrait(caster, 'finale')
    if (!trait) return false
    const d10 = await rollDiceBoxValues(6, 10, '曲终力场伤害', target.label)
    const d8 = trait.level > 1 ? await rollDiceBoxValues(trait.level - 1, 8, '曲终等级额外伤害', target.label) : []
    const total = [...d10, ...d8].reduce((sum, value) => sum + value, 0)
    const latest = useCharacterStore.getState().characters.find((c) => c.id === caster.id)
    updateChar(caster.id, {
      combatBuffs: { ...(latest?.combatBuffs ?? caster.combatBuffs), finaleReady: undefined },
    })
    updateToken(activeMap.id, target.id, { huntingMarkStacks: 0, stunTurns: STUN_DEFAULT_TURNS })
    addConditionToCharacter(target.characterId, STUN_STATUS_LABEL)
    applyDirectFeatureDamage(target, total, '曲终')
    pushCombatLog(
      `${caster.name} 的曲终触发：${target.label} 狩猎印记达到 4 层，${[...d10, ...d8].join(' + ')} = ${total} 点力场伤害，眩晕并移除所有狩猎印记`,
      'damage',
    )
    return true
  }

  const huntingComboTraitRank = (caster?: Character) =>
    caster ? (findClassTrait(caster, 'huntingCombo')?.level ?? 0) : 0

  const isEnemyTarget = (token: Token): boolean => token.type === 'enemy'

  const isBeastLikeTarget = (token: Token): boolean => {
    const key = `${token.poolId ?? ''} ${token.label}`.toLowerCase()
    return [
      'wolf',
      'bear',
      'spider',
      'slime',
      'owlbear',
      'harpy',
      '兽',
      '动物',
      '狼',
      '熊',
      '蛛',
      '史莱姆',
    ].some((part) => key.includes(part))
  }

  const huntingComboCritBonusMultiplier = (caster: Character | undefined, token: Token) => {
    if (!caster || (token.huntingMarkStacks ?? 0) <= 0) return 0
    const rank = huntingComboTraitRank(caster)
    return rank > 0 ? 0.2 + (rank - 1) * 0.05 : 0
  }

  const calmSpiritCritThreshold = (caster?: Character) => {
    const bonus = caster?.combatBuffs?.calmSpiritCritBonusPercent ?? 0
    return Math.max(1, 20 - Math.floor(bonus / 5))
  }

  const resolvePlayerDamageTotal = (
    caster: Character,
    skill: CombatSkill,
    values: number[],
    opts: { isCrit: boolean; target: Token },
  ) => {
    const base = values.reduce((sum, value) => sum + value, 0) + skill.damageBonus
    let total = resolveAttackDamageTotal(caster, skill, values, { isCrit: opts.isCrit })
    if (opts.isCrit) {
      const extraCrit = huntingComboCritBonusMultiplier(caster, opts.target)
      if (extraCrit > 0) {
        total += Math.floor(base * extraCrit)
      }
    }
    return total
  }

  const appendArcherFeatureDamageDice = async (
    values: number[],
    caster: Character,
    token: Token,
    skillName: string,
  ): Promise<{ values: number[]; labelParts: string[] }> => {
    const next = [...values]
    const labelParts: string[] = []
    const calm = findClassTrait(caster, 'calmMind')
    if (calm && isCalmMindActive(caster) && calm.level > 0) {
      const extra = await rollDiceBoxValues(calm.level, 6, `${skillName} 静心额外伤害`, token.label)
      next.push(...extra)
      labelParts.push(`静心+${calm.level}d6`)
    }
    const hmRank = huntingMarkTraitRank(caster)
    if (hmRank > 0 && (token.huntingMarkStacks ?? 0) > 0) {
      const extra = await rollDiceBoxValues(hmRank, 8, `${skillName} 狩猎印记额外伤害`, token.label)
      next.push(...extra)
      labelParts.push(`印记+${hmRank}d8`)
    }
    const animalMastery = findClassTrait(caster, 'animalMastery')
    if (animalMastery && isBeastLikeTarget(token)) {
      const extra = await rollDiceBoxValues(animalMastery.level, 6, `${skillName} 动物学专精额外伤害`, token.label)
      next.push(...extra)
      labelParts.push(`动物学+${animalMastery.level}d6`)
    }
    if (caster.combatBuffs?.shadowVeilTargetId === token.id) {
      const extra = await rollDiceBoxValues(1, 6, `${skillName} 影遁之术额外伤害`, token.label)
      next.push(...extra)
      labelParts.push('影遁+1d6')
    }
    return { values: next, labelParts }
  }

  const appendDoubleArrowDamageDice = async (
    values: number[],
    caster: Character,
    enabled: boolean,
  ): Promise<{ values: number[]; labelParts: string[] }> => {
    if (!enabled) return { values, labelParts: [] }
    const trait = findClassTrait(caster, 'doubleArrow')
    if (!trait) return { values, labelParts: [] }
    return {
      values,
      labelParts: ['双箭：2支箭'],
    }
  }

  type AttackResolveResult = {
    hit: boolean
    total: number
    values: number[]
    rollLabel: string
    d20Roll?: DiceRoll['d20Roll']
    knockbackPending?: KnockbackPending
    selfCooldownReduction?: number
  }

  const resolveAttack = async (
    token: Token,
    opts?: {
      skipCleanup?: boolean
      skipUseSkill?: boolean
      silent?: boolean
      aoeTargetCount?: number
      skillOverride?: CombatSkill
      presetDamageValues?: number[]
      presetFeatureLabelParts?: string[]
    },
  ): Promise<AttackResolveResult | undefined> => {
    if (!targeting || !activeMap) return
    const { casterId, doubleArrow } = targeting
    const skill = opts?.skillOverride ?? targeting.skill
    const caster = characters.find((c) => c.id === casterId)
    const casterToken = activeMap.tokens.find((t) => t.characterId === casterId)
    const targetChar = token.characterId
      ? characters.find((c) => c.id === token.characterId)
      : undefined
    const targetAc = targetChar ? getAc(targetChar) : (getTokenTargetAc(token) ?? 12)
    const isRanged =
      skill.tags?.includes('ranged') || skill.name === '远程射击' || skill.name === '基础射击'
    if (!opts?.silent && casterToken && isBasicShot(skill)) {
      launchArrowProjectile({ x: casterToken.x, y: casterToken.y }, { x: token.x, y: token.y })
    }
    const isAoeResolution = opts?.aoeTargetCount != null
    const outOfBreath = caster && !isAoeResolution ? isOutOfBreath(caster) : false
    const calmSpiritCritBonus = caster?.combatBuffs?.calmSpiritCritBonusPercent ?? 0
    const skillRank = caster && skill.skillTreeId ? getSkillRank(caster, skill.skillTreeId) : 0
    const targetKnockedBeforeAttack = tokenHasKnockback(token, targetChar)
    const huntingComboIgnoresDodge =
      !!caster && huntingComboTraitRank(caster) > 0 && (token.huntingMarkStacks ?? 0) > 0
    const windTraceMarkedAdvantage =
      skill.skillTreeId === 'windTraceShot' &&
      skillRank >= 5 &&
      (opts?.aoeTargetCount ?? 0) === 1 &&
      (token.huntingMarkStacks ?? 0) > 0
    const effectiveAdvantage = windTraceMarkedAdvantage && !outOfBreath
    const advantageCancelled = windTraceMarkedAdvantage && outOfBreath
    const effectiveDisadvantage = outOfBreath && !windTraceMarkedAdvantage
    /** 气喘会要求命中骰；风痕贯射 5 阶在单目标带印记时也会要求命中骰来处理优势暴击 */
    const needsAttackRoll = !!(
      caster &&
      skill.damageCount > 0 &&
      (outOfBreath || windTraceMarkedAdvantage || calmSpiritCritBonus > 0)
    )

    let values: number[]
    let total: number
    let hit = true
    let isCrit = false
    let rollLabel: string
    let d20Roll:
      | { value: number; modifier: number; ac: number; hit: boolean; isCrit?: boolean; source?: 'dice-box' }
      | undefined
    let selfCooldownReduction = 0
    let featureExtraLabelParts: string[] = []
    let critFormulaLabel = ''
    let enemyDodgeLabel = ''
    let enemyDodgeChecked = false

    if (needsAttackRoll) {
      const forceCrit = !!caster!.combatBuffs?.preciseStrikeReady
      const attackAbility = skill.tags?.includes('melee') ? 'str' : 'dex'
      const attackD20 = await rollDiceBoxD20(`${skill.name} D20`, token.label)
      const attackD20Second = effectiveAdvantage
        ? await rollDiceBoxD20(`${skill.name} 优势 D20`, token.label)
        : undefined
      const atk = resolveRangedAttackRoll(caster!, skill, huntingComboIgnoresDodge ? 0 : targetAc, !!(doubleArrow && isRanged), {
        targetHuntingMarks: token.huntingMarkStacks ?? 0,
        advantage: effectiveAdvantage,
        disadvantage: effectiveDisadvantage,
        critThreshold: calmSpiritCritThreshold(caster),
        forceCrit,
        ability: attackAbility,
        d20: attackD20,
        d20Second: attackD20Second,
        damageValues: [],
      })
      hit = atk.hit
      isCrit = atk.isCrit || (effectiveAdvantage && windTraceMarkedAdvantage && atk.hit)
      if (hit && caster) {
        const enemyDodge = await resolveEnemyAutoDodge(token, caster, skill, opts?.aoeTargetCount != null)
        if (enemyDodge) {
          enemyDodgeChecked = true
          enemyDodgeLabel = `敌人闪避 ${enemyDodge.d20}+${enemyDodge.attackBonus}=${enemyDodge.total} vs AC${enemyDodge.targetAc}${enemyDodge.dodged ? '，成功' : '，失败'}`
          if (enemyDodge.dodged) {
            hit = false
            isCrit = false
          }
        }
      }
      if (hit) {
        const diceCount = attackDamageDiceCount(skill, !!(doubleArrow && isRanged))
        const damageSides = isBasicShot(skill) ? 8 : skill.damageSides
        values = await rollDiceBoxValues(diceCount, damageSides, `${skill.name} 伤害`, token.label)
        const extraD6Count = windTraceExtraDiceCount(skill.skillTreeId, skillRank, caster!, token, opts?.aoeTargetCount)
        if (extraD6Count > 0) {
          const extraValues = await rollDiceBoxValues(extraD6Count, 6, `${skill.name} 额外伤害`, token.label)
          values = [...values, ...extraValues]
        }
        if (skill.skillTreeId === 'eagleStrike') {
          const extraD6Count = eagleStrikeExtraDiceCount(skillRank)
          if (extraD6Count > 0) {
            const extraValues = await rollDiceBoxValues(extraD6Count, 6, `${skill.name} 击飞伤害`, token.label)
            values = [...values, ...extraValues]
          }
        }
        const doubleArrowExtra = await appendDoubleArrowDamageDice(
          values,
          caster!,
          !!(doubleArrow && isRanged),
        )
        values = doubleArrowExtra.values
        featureExtraLabelParts = [...featureExtraLabelParts, ...doubleArrowExtra.labelParts]
        const featureExtra = await appendArcherFeatureDamageDice(values, caster!, token, skill.name)
        values = featureExtra.values
        featureExtraLabelParts = [...featureExtraLabelParts, ...featureExtra.labelParts]
        const critApplies = isCrit && !(doubleArrow && isRanged)
        if (critApplies && caster) {
          const comboCrit = huntingComboCritBonusMultiplier(caster, token)
          critFormulaLabel = ` × 暴击${formatCritDamagePercent(caster)}${comboCrit > 0 ? ` + 狩猎连击${Math.round(comboCrit * 100)}%` : ''}`
        }
        total = caster
          ? resolvePlayerDamageTotal(caster, skill, values, {
              isCrit: critApplies,
              target: token,
            })
          : values.reduce((a, b) => a + b, 0) + skill.damageBonus
      } else {
        values = []
        total = 0
      }
      d20Roll = {
        value: atk.d20,
        modifier: atk.attackBonus,
        ac: atk.ac,
        hit,
        isCrit,
        source: 'dice-box',
      }

      const d20Text =
        atk.d20Second != null ? `${attackD20}/${attackD20Second}取${atk.d20}` : `${atk.d20}`
      const stateText = effectiveAdvantage
        ? '优势'
        : advantageCancelled
          ? '优势/气喘抵消'
          : effectiveDisadvantage
            ? '气喘·劣势'
            : calmSpiritCritBonus > 0
              ? `安定心神暴击+${calmSpiritCritBonus}%`
              : '命中'
      const dodgeText = huntingComboIgnoresDodge ? ' · 狩猎连击：忽视闪避' : ''
      const abilityMod = getEffectiveAbilityMod(caster!, attackAbility)
      const prof = atk.attackBonus - abilityMod
      const abilityLabel = attackAbility === 'str' ? '力量' : attackAbility === 'dex' ? '敏捷' : attackAbility
      const attackFormula = `${d20Text} + ${abilityLabel}调整${abilityMod >= 0 ? '+' : ''}${abilityMod}${prof ? ` + 熟练${prof >= 0 ? '+' : ''}${prof}` : ''} = ${atk.attackTotal}`
      rollLabel = `${skill.name}${doubleArrow && isRanged ? '（双箭）' : ''}${forceCrit ? '（精准打击）' : ''}（${stateText}）· 命中 ${attackFormula} vs AC${atk.ac}${isCrit ? ' 重击' : ''}${hit ? '' : ' 未中'}`
      rollLabel += dodgeText
    } else {
      const forceCrit = !!caster?.combatBuffs?.preciseStrikeReady
      const diceCount = attackDamageDiceCount(skill, !!doubleArrow)
      const damageSides = isBasicShot(skill) ? 8 : skill.damageSides
      if (caster) {
        const enemyDodge = await resolveEnemyAutoDodge(token, caster, skill, opts?.aoeTargetCount != null)
        if (enemyDodge) {
          enemyDodgeChecked = true
          enemyDodgeLabel = `敌人闪避 ${enemyDodge.d20}+${enemyDodge.attackBonus}=${enemyDodge.total} vs AC${enemyDodge.targetAc}${enemyDodge.dodged ? '，成功' : '，失败'}`
          if (enemyDodge.dodged) {
            hit = false
            isCrit = false
          }
        }
      }
      if (hit) {
      values =
        opts?.presetDamageValues?.slice() ??
        await rollDiceBoxValues(diceCount, damageSides, `${skill.name} 伤害`, token.label)
      featureExtraLabelParts = opts?.presetFeatureLabelParts?.slice() ?? []
      if (caster && !opts?.presetDamageValues) {
        const extraD6Count = windTraceExtraDiceCount(skill.skillTreeId, skillRank, caster, token, opts?.aoeTargetCount)
        if (extraD6Count > 0) {
          const extraValues = await rollDiceBoxValues(extraD6Count, 6, `${skill.name} 额外伤害`, token.label)
          values = [...values, ...extraValues]
        }
        if (skill.skillTreeId === 'eagleStrike') {
          const extraD6Count = eagleStrikeExtraDiceCount(skillRank)
          if (extraD6Count > 0) {
            const extraValues = await rollDiceBoxValues(extraD6Count, 6, `${skill.name} 击飞伤害`, token.label)
            values = [...values, ...extraValues]
          }
        }
        const doubleArrowExtra = await appendDoubleArrowDamageDice(
          values,
          caster,
          !!doubleArrow,
        )
        values = doubleArrowExtra.values
        featureExtraLabelParts = [...featureExtraLabelParts, ...doubleArrowExtra.labelParts]
        const featureExtra = await appendArcherFeatureDamageDice(values, caster, token, skill.name)
        values = featureExtra.values
        featureExtraLabelParts = [...featureExtraLabelParts, ...featureExtra.labelParts]
      }
      if (caster) {
        if (forceCrit) isCrit = true
        if (isCrit) {
          const comboCrit = huntingComboCritBonusMultiplier(caster, token)
          critFormulaLabel = ` × 暴击${formatCritDamagePercent(caster)}${comboCrit > 0 ? ` + 狩猎连击${Math.round(comboCrit * 100)}%` : ''}`
        }
        total = resolvePlayerDamageTotal(caster, skill, values, { isCrit, target: token })
      } else {
        total = values.reduce((a, b) => a + b, 0) + skill.damageBonus
      }
      } else {
        values = []
        total = 0
        featureExtraLabelParts = []
      }
      const extraDiceCount = Math.max(0, values.length - diceCount)
      const extraDiceLabel = extraDiceCount > 0 ? `+${extraDiceCount}d6` : ''
      const featureDiceLabel =
        featureExtraLabelParts.length > 0 ? `+${featureExtraLabelParts.join('+')}` : ''
      const diceLabel = `${diceCount}d${damageSides}${extraDiceLabel}${featureDiceLabel}${skill.damageBonus ? `+${skill.damageBonus}` : ''}`
      rollLabel = `${skill.name}${doubleArrow ? '（双箭）' : ''}${forceCrit ? '（精准打击）' : ''} ${diceLabel}`
    }

    if (hit && caster) {
      const casterTokenId = activeMap.tokens.find((t) => t.characterId === casterId)?.id
      const isFirstInInitiative =
        combatActive &&
        round === 1 &&
        initiativeOrder.length > 0 &&
        initiativeOrder[0]?.tokenId === casterTokenId
      if (
        isFirstInInitiative &&
        findClassTrait(caster, 'silentDraw') &&
        !caster.combatBuffs?.silentDrawUsed
      ) {
        const sd = findClassTrait(caster, 'silentDraw')!
        const extraValues = await rollDiceBoxValues(sd.level, 6, `${skill.name} 无声起弦额外伤害`, token.label)
        values.push(...extraValues)
        total += extraValues.reduce((sum, value) => sum + value, 0)
        featureExtraLabelParts.push(`无声起弦+${sd.level}d6`)
      }

      if (findClassTrait(caster, 'arcaneDevour') && skill.skillTreeId?.includes('magic')) {
        const trait = findClassTrait(caster, 'arcaneDevour')!
        const extra = Array.from({ length: trait.level }, () => 1 + Math.floor(Math.random() * 6)).reduce(
          (a, b) => a + b,
          0,
        )
        values.push(extra)
        total += extra
      }

      const takeoff = findClassTrait(caster, 'takeoff')
      if (takeoff && skill.skillTreeId === 'whirlwindKick' && targetKnockedBeforeAttack) {
        const count = Math.min(3, takeoff.level)
        const extraValues = await rollDiceBoxValues(count, 6, `${skill.name} 起飞额外伤害`, token.label)
        values.push(...extraValues)
        total += extraValues.reduce((sum, value) => sum + value, 0)
        featureExtraLabelParts.push(`起飞+${count}d6`)
      }

      const enemyDodge = !enemyDodgeChecked
        ? await resolveEnemyAutoDodge(token, caster, skill, opts?.aoeTargetCount != null)
        : null
      if (enemyDodge) {
        enemyDodgeLabel = `敌人闪避 ${enemyDodge.d20}+${enemyDodge.attackBonus}=${enemyDodge.total} vs AC${enemyDodge.targetAc}${enemyDodge.dodged ? '，成功' : '，失败'}`
        if (enemyDodge.dodged) {
          hit = false
          isCrit = false
          values = []
          total = 0
          featureExtraLabelParts = []
        }
      }

      const comboFist = findClassTrait(caster, 'comboFist')
      const waivedApAttack = !!targeting?.waiveAp || !!caster.combatBuffs?.galeComboReady
      if (hit && comboFist && waivedApAttack) {
        const extraValues = await rollDiceBoxValues(comboFist.level, 6, `${skill.name} 连续拳额外伤害`, token.label)
        values.push(...extraValues)
        total += extraValues.reduce((sum, value) => sum + value, 0)
        featureExtraLabelParts.push(`连续拳+${comboFist.level}d6`)
      }
    }

    if (hit && caster) {
      const pi = findClassTrait(caster, 'piercingInsight')
      if (pi) {
        let lowHp = false
        if (targetChar) {
          lowHp = targetChar.currentHp / targetChar.maxHp < 0.1
        } else if (token.maxHp != null) {
          const cur = token.hp ?? token.maxHp
          lowHp = cur / token.maxHp < 0.1
        }
        if (lowHp) {
          const extra = Array.from({ length: pi.level }, () => 1 + Math.floor(Math.random() * 4)).reduce(
            (a, b) => a + b,
            0,
          )
          values.push(extra)
          total += extra
        }
      }
    }

    if (doubleArrow && hit) useClassFeature(casterId, 'doubleArrow')

    if (caster) {
      const buffPatch: Partial<NonNullable<Character['combatBuffs']>> = {}
      if (caster.combatBuffs?.preciseStrikeReady && hit) {
        useClassFeature(casterId, 'preciseStrike')
        buffPatch.preciseStrikeReady = undefined
      }
      if (caster.combatBuffs?.calmSpiritCritBonusPercent) {
        buffPatch.calmSpiritCritBonusPercent = undefined
      }
      if (skill.skillTreeId === 'burstKick' && caster.combatBuffs?.burstKickExtraD6) {
        buffPatch.burstKickExtraD6 = undefined
      }
      if (skill.skillTreeId === 'windKickCombo' && caster.combatBuffs?.windKickTreatKnockbackTargetId) {
        buffPatch.windKickTreatKnockbackTargetId = undefined
      }
      if (caster.combatBuffs?.shadowVeilTargetId === token.id) {
        buffPatch.shadowVeilTargetId = undefined
      }
      if (hit && findClassTrait(caster, 'silentDraw') && !caster.combatBuffs?.silentDrawUsed) {
        const casterTokenId = activeMap.tokens.find((t) => t.characterId === casterId)?.id
        const isFirstInInitiative =
          combatActive &&
          round === 1 &&
          initiativeOrder.length > 0 &&
          initiativeOrder[0]?.tokenId === casterTokenId
        if (isFirstInInitiative) buffPatch.silentDrawUsed = true
      }
      if (Object.keys(buffPatch).length > 0) {
        updateChar(casterId, { combatBuffs: { ...caster.combatBuffs, ...buffPatch } })
      }
    }

    const burnTurns = hit ? statusDuration(skill, 'burning') : undefined
    const poisonTurns = hit ? statusDuration(skill, 'poison') : undefined
    const tokenPatch: Partial<Token> = {}
    let knockbackPending: KnockbackPending | undefined
    let dexSaveLabel = ''
    let stunSaveLabel = ''
    let damageBonusForRoll = skill.damageBonus
    let damageBeforeDefense = total
    let attackDefenseDiff: number | null = null
    let attackDefenseModifier = 0

    if (hit) {
      const dexMode = dexSaveDamageMode(skill.skillTreeId)
      if (caster && dexMode && total > 0) {
        const save = resolveKnockbackSave(caster, token, targetChar)
        dexSaveLabel = formatSkillDexSaveLabel(save, dexMode)
        if (dexMode === 'fail-half' && !save.success) {
          total = Math.floor(total / 2)
        } else if (save.success && dexMode !== 'fail-half') {
          total = dexMode === 'half' ? Math.floor(total / 2) : 0
        } else if (
          skill.skillTreeId === 'whirlwindKick' &&
          skillGrantsKnockbackOnHit(caster, skill)
        ) {
          applyKnockbackFromSave(token.id, token.characterId, caster, casterId, save)
        }
      }
      if (caster && casterToken && skill.skillTreeId === 'clusterShot') {
        const distFeet = cellDistance(
          pixelToCell(casterToken.x, casterToken.y, activeMap),
          pixelToCell(token.x, token.y, activeMap),
        ) * 5
        if (distFeet > 10 && distFeet <= 20) {
          total = Math.floor(total / 2)
          featureExtraLabelParts.push('集束射击远距减半')
        }
      }
      if (caster && skill.skillTreeId === 'burstKick' && (caster.combatBuffs?.burstKickExtraD6 ?? 0) > 0) {
        const count = caster.combatBuffs?.burstKickExtraD6 ?? 0
        const extraValues = await rollDiceBoxValues(count, 6, `${skill.name} 捆绑射击额外伤害`, token.label)
        values.push(...extraValues)
        total += extraValues.reduce((sum, value) => sum + value, 0)
        featureExtraLabelParts.push(`捆绑射击+${count}d6`)
      }
      const explosiveArrowTrait = caster ? findClassTrait(caster, 'explosiveArrow') : undefined
      if (caster && isCrit && explosiveArrowTrait) {
        const fireDice = explosiveArrowTrait.level
        const fireValues = await rollDiceBoxValues(fireDice, 12, `${skill.name} 爆裂箭矢重击火焰`, token.label)
        values.push(...fireValues)
        total += fireValues.reduce((sum, value) => sum + value, 0)
        tokenPatch.burningTurns = Math.max(tokenPatch.burningTurns ?? 0, 1)
        tokenPatch.igniteTurns = Math.max(tokenPatch.igniteTurns ?? 0, 1)
        featureExtraLabelParts.push(`爆裂箭矢+${fireDice}d12，火焰标记+1`)
      }
      if (caster && skill.skillTreeId === 'antiMagicArrow') {
        const hasMagicState =
          !!token.burningTurns ||
          !!token.igniteTurns ||
          !!token.poisonTurns ||
          !!token.stunTurns ||
          !!token.knockbackTurns ||
          !!token.restrainedTurns ||
          !!token.vulnerableTurns ||
          (targetChar?.conditions.length ?? 0) > 0
        if (hasMagicState) {
          const extraValues = await rollDiceBoxValues(2, 6, `${skill.name} 魔法状态额外伤害`, token.label)
          values.push(...extraValues)
          total += extraValues.reduce((sum, value) => sum + value, 0)
          featureExtraLabelParts.push('魔法状态+2d6')
        }
      }
      damageBeforeDefense = total

      if (total > 0) {
        const damageType = caster && isMagicDamageSkill(skill) ? 'magic' : 'physical'
        const attackerInput = caster ? characterToCombatInput(caster) : undefined
        const adjustedDamage =
          targetChar != null
            ? applyAttackDefenseDamageModifier(
                total,
                attackerInput,
                characterToCombatInput(targetChar),
                damageType,
              )
            : adjustDamageAgainstToken(total, attackerInput, token, damageType)
        const finalDamage = adjustedDamage.damage
        attackDefenseDiff = adjustedDamage.diff
        attackDefenseModifier = adjustedDamage.modifier
        damageBonusForRoll = finalDamage - values.reduce((a, b) => a + b, 0)
        total = finalDamage
        if (token.characterId) {
          damageChar(token.characterId, finalDamage)
          const updated = useCharacterStore.getState().characters.find((c) => c.id === token.characterId)
          if (updated) {
            tokenPatch.hp = updated.currentHp
            tokenPatch.maxHp = updated.maxHp
            if (updated.currentHp <= 0) {
              deferDeathHandling(token.id, token.characterId)
            }
          }
        } else if (token.maxHp != null) {
          tokenPatch.hp = Math.max(0, (token.hp ?? token.maxHp) - finalDamage)
          if (tokenPatch.hp <= 0) deferDeathHandling(token.id)
        }
        const vengeanceBlood = caster ? findClassTrait(caster, 'vengeanceBlood') : undefined
        if (caster && vengeanceBlood && finalDamage > 0 && (token.huntingMarkStacks ?? 0) > 0 && vengeanceBlood.uses > 0) {
          const heal = Math.floor(finalDamage / 2)
          if (heal > 0 && window.confirm(`复仇之血：消耗 1 次使用，回复 ${heal} 点生命？`)) {
            const latestCaster = useCharacterStore.getState().characters.find((c) => c.id === caster.id)
            if (latestCaster) {
              useClassFeature(caster.id, 'vengeanceBlood')
              updateChar(caster.id, { currentHp: Math.min(latestCaster.maxHp, latestCaster.currentHp + heal) })
              featureExtraLabelParts.push(`复仇之血回复${heal}`)
            }
          }
        }
      }
      if (burnTurns) tokenPatch.burningTurns = burnTurns
      if (poisonTurns) tokenPatch.poisonTurns = poisonTurns
      if (
        total > 0 &&
        caster &&
        huntingMarkTraitRank(caster) > 0 &&
        isEnemyTarget(token)
      ) {
        tokenPatch.huntingMarkStacks = Math.min(4, (token.huntingMarkStacks ?? 0) + 1)
      }

      const multiStrike = caster ? findClassTrait(caster, 'multiStrike') : undefined
      if (caster && multiStrike && total > 0) {
        const hitKey = `${caster.id}:${token.id}`
        const hits = (multiStrikeHitsRef.current[hitKey] ?? 0) + 1
        multiStrikeHitsRef.current[hitKey] = hits
        if (hits >= 3 && (caster.qi ?? 0) >= 1 && window.confirm(`多重打击：${token.label} 本回合已受到 ${hits} 段攻击。消耗 1 点气使其体质劣势豁免，失败眩晕？`)) {
          if (spendQi(caster.id, 1)) {
            const saveA = resolveConSave(caster, token, targetChar)
            const saveB = resolveConSave(caster, token, targetChar)
            const save = saveA.saveTotal <= saveB.saveTotal ? saveA : saveB
            stunSaveLabel = `${formatConSaveLabel(save)}（劣势：${saveA.saveD20}/${saveB.saveD20}）`
            if (!save.success) tokenPatch.stunTurns = STUN_DEFAULT_TURNS
            multiStrikeHitsRef.current[hitKey] = 0
          }
        }
      }

      if (caster && skill.skillTreeId === 'rageShot' && skillRank >= 3) {
        const save = await resolveAbilitySave(caster, token, targetChar, 'str', '怒气爆射力量豁免')
        featureExtraLabelParts.push(abilitySaveLabel('力量豁免', save, '成功，未束缚', '失败，束缚'))
        if (!save.success) {
          tokenPatch.restrainedTurns = 1
          addConditionToCharacter(token.characterId, RESTRAINED_STATUS_LABEL)
        }
      }

      if (caster && casterToken && skill.skillTreeId === 'bindShot') {
        const save = await resolveAbilitySave(caster, token, targetChar, 'str', '捆绑射击力量豁免')
        featureExtraLabelParts.push(abilitySaveLabel('力量豁免', save, '成功，未拉近', '失败，拉近'))
        if (!save.success) {
          const tc = pixelToCell(token.x, token.y, activeMap)
          const cc = pixelToCell(casterToken.x, casterToken.y, activeMap)
          moveTokenByCells(token, cc.col - tc.col, cc.row - tc.row, 2)
          if (skillRank >= 4) {
            tokenPatch.restrainedTurns = 1
            addConditionToCharacter(token.characterId, RESTRAINED_STATUS_LABEL)
          }
        }
        updateChar(caster.id, {
          combatBuffs: { ...caster.combatBuffs, burstKickExtraD6: 1 },
        })
      }

      if (caster && skill.skillTreeId === 'riseKick') {
        updateChar(caster.id, {
          conditions: caster.conditions.filter((c) => c !== '倒地'),
          combatBuffs: {
            ...caster.combatBuffs,
            freeMoveFeet: skillRank >= 4 ? 10 : caster.combatBuffs?.freeMoveFeet,
          },
        })
        featureExtraLabelParts.push(skillRank >= 4 ? '解除倒地，获得免费移动10尺' : '解除倒地')
        if (skillRank >= 4) setShowMoveRange(true)
      }

      if (caster && casterToken && skill.skillTreeId === 'windKickCombo') {
        const treatedKnockback = caster.combatBuffs?.windKickTreatKnockbackTargetId === token.id
        if ((targetKnockedBeforeAttack || treatedKnockback) && skillRank >= 5) {
          selfCooldownReduction = Math.max(selfCooldownReduction, 1)
          featureExtraLabelParts.push('目标击飞，踏风连踢 CD -1')
        }
        if (confirm(`踏风连踢：是否推动 ${token.label} 5 尺？`)) {
          const tc = pixelToCell(token.x, token.y, activeMap)
          const cc = pixelToCell(casterToken.x, casterToken.y, activeMap)
          moveTokenByCells(token, tc.col - cc.col, tc.row - cc.row, 1)
          featureExtraLabelParts.push('推动5尺')
        }
      }

      if (caster && skill.skillTreeId === 'refluxMagicArrow') {
        const amount = isCrit && skillRank >= 3 ? 2 : 1
        chooseCooldownSkillToReduce(caster, amount, `${skill.name} 命中`)
      }

      if (caster && skill.skillTreeId === 'encircle') {
        const casterTokenForStatus = activeMap.tokens.find((t) => t.characterId === caster.id)
        if (casterTokenForStatus) {
          updateToken(activeMap.id, casterTokenForStatus.id, { noMoveTurns: 1 })
          addConditionToCharacter(caster.id, NO_MOVE_STATUS_LABEL)
        }
        if (skillRank >= 5 && (skill.arrowShots ?? 0) >= 5) {
          const save = resolveConSave(caster, token, targetChar)
          stunSaveLabel = formatConSaveLabel(save)
          if (!save.success) tokenPatch.stunTurns = STUN_DEFAULT_TURNS
        }
      }

      if (caster && skill.skillTreeId === 'antiMagicArrow') {
        if (skillRank >= 3) {
          tokenPatch.vulnerableTurns = 1
          addConditionToCharacter(token.characterId, VULNERABLE_STATUS_LABEL)
          featureExtraLabelParts.push('脆弱1回合')
        }
        if (skillRank >= 4) {
          let removed = 0
          const clearPatch: Partial<Token> = {}
          for (const key of ['burningTurns', 'igniteTurns', 'poisonTurns', 'stunTurns', 'knockbackTurns', 'restrainedTurns', 'vulnerableTurns'] as const) {
            if ((token[key] ?? 0) > 0) {
              clearPatch[key] = 0
              removed++
            }
          }
          if (Object.keys(clearPatch).length > 0) updateToken(activeMap.id, token.id, clearPatch)
          if (targetChar && targetChar.conditions.length > 0) {
            removed += targetChar.conditions.length
            updateChar(targetChar.id, { conditions: [] })
          }
          if (removed > 0) {
            featureExtraLabelParts.push(`移除${removed}个状态`)
            if (skillRank >= 5) selfCooldownReduction = Math.max(selfCooldownReduction, removed)
          }
        }
      }

      if (caster && skill.skillTreeId === 'shadowStepShot') {
        updateChar(caster.id, {
          combatBuffs: { ...caster.combatBuffs, freeMoveFeet: skillRank >= 4 ? 15 : 10 },
        })
        setDisengagedCharIds((prev) => new Set(prev).add(caster.id))
        setShowMoveRange(true)
        featureExtraLabelParts.push(`影步移动${skillRank >= 4 ? 15 : 10}尺，不触发借机`)
      }

      if (caster && skill.skillTreeId === 'shadowDance') {
        updateChar(caster.id, {
          combatBuffs: {
            ...caster.combatBuffs,
            freeMoveFeet: 15,
            windKickTreatKnockbackTargetId: skillRank >= 3 ? token.id : undefined,
          },
        })
        setDisengagedCharIds((prev) => new Set(prev).add(caster.id))
        setShowMoveRange(true)
        featureExtraLabelParts.push(skillRank >= 3 ? '影遁移动，不触发借机；踏风连踢视为击飞' : '影遁移动，不触发借机')
      }

      if (caster && findClassTrait(caster, 'swiftRecall') && isMagicDamageSkill(skill)) {
        const appliedStatus =
          !!tokenPatch.burningTurns ||
          !!tokenPatch.poisonTurns ||
          !!tokenPatch.stunTurns ||
          !!tokenPatch.knockbackTurns ||
          !!tokenPatch.restrainedTurns ||
          !!tokenPatch.vulnerableTurns ||
          !!tokenPatch.noMoveTurns
        if (appliedStatus) {
          if (window.confirm('迅捷回溯：获得 1 枚通用令牌。确定用于技能 CD -1，取消则回复 1 AP。')) {
            chooseCooldownSkillToReduce(caster, 1, '迅捷回溯')
          } else {
            const latest = useCharacterStore.getState().characters.find((c) => c.id === caster.id)
            if (latest) updateChar(caster.id, { currentAP: Math.min(latest.actionPoints, latest.currentAP + 1) })
          }
          featureExtraLabelParts.push('迅捷回溯')
        }
      }

      if (caster && findClassTrait(caster, 'arcaneDance')) {
        const choice = window.prompt('魔能狂舞：选择附加状态（fire/poison/ice/acid/force/mind），留空则不触发')
        const picked = choice?.trim().toLowerCase()
        if (picked === 'fire') {
          tokenPatch.burningTurns = Math.max(tokenPatch.burningTurns ?? 0, 1)
          addConditionToCharacter(token.characterId, STATUS_LABEL.burning)
          featureExtraLabelParts.push('魔能狂舞：燃烧')
        } else if (picked === 'poison') {
          tokenPatch.poisonTurns = Math.max(tokenPatch.poisonTurns ?? 0, 1)
          addConditionToCharacter(token.characterId, STATUS_LABEL.poison)
          featureExtraLabelParts.push('魔能狂舞：中毒')
        } else if (picked === 'ice' || picked === 'acid' || picked === 'force' || picked === 'mind') {
          tokenPatch.noMoveTurns = Math.max(tokenPatch.noMoveTurns ?? 0, 1)
          addConditionToCharacter(token.characterId, NO_MOVE_STATUS_LABEL)
          featureExtraLabelParts.push(`魔能狂舞：${picked}`)
        }
      }

      const grantsKnockback =
        caster &&
        skillGrantsKnockbackOnHit(caster, skill) &&
        skill.skillTreeId !== 'whirlwindKick'
      if (grantsKnockback) {
        knockbackPending = {
          tokenId: token.id,
          tokenLabel: token.label,
          targetCharId: token.characterId,
          casterId,
          skill,
        }
      }

      const stunSkillRank =
        caster && skill.skillTreeId ? getSkillRank(caster, skill.skillTreeId) : 0
      const grantsStun =
        hit &&
        caster &&
        skill.skillTreeId != null &&
        skillGrantsStun(skill.skillTreeId, stunSkillRank)
      if (grantsStun) {
        const save = resolveConSave(caster!, token, targetChar)
        stunSaveLabel = formatConSaveLabel(save)
        if (!save.success) {
          tokenPatch.stunTurns = STUN_DEFAULT_TURNS
        }
      }

      if (Object.keys(tokenPatch).length > 0) {
        updateToken(activeMap.id, token.id, tokenPatch)
        if (tokenPatch.hp != null && tokenPatch.hp <= 0) {
          deferDeathHandling(token.id, token.characterId)
        }
      }
      if (token.characterId) {
        const ch = characters.find((c) => c.id === token.characterId)
        if (ch) {
          const conds = [...ch.conditions]
          if (burnTurns && !conds.includes(STATUS_LABEL.burning)) conds.push(STATUS_LABEL.burning)
          if (poisonTurns && !conds.includes(STATUS_LABEL.poison)) conds.push(STATUS_LABEL.poison)
          if (tokenPatch.stunTurns && !conds.includes(STUN_STATUS_LABEL)) {
            conds.push(STUN_STATUS_LABEL)
          }
          if (tokenPatch.restrainedTurns && !conds.includes(RESTRAINED_STATUS_LABEL)) {
            conds.push(RESTRAINED_STATUS_LABEL)
          }
          if (tokenPatch.vulnerableTurns && !conds.includes(VULNERABLE_STATUS_LABEL)) {
            conds.push(VULNERABLE_STATUS_LABEL)
          }
          if (tokenPatch.noMoveTurns && !conds.includes(NO_MOVE_STATUS_LABEL)) {
            conds.push(NO_MOVE_STATUS_LABEL)
          }
          if (conds.length !== ch.conditions.length) {
            updateChar(token.characterId, { conditions: conds })
          }
        }
      }
      if (
        caster &&
        casterToken &&
        isCrit &&
        canUseArmorPiercing(caster, skill, true)
      ) {
        const apTrait = findClassTrait(caster, 'armorPiercingArrow')
        const splash = Math.floor(total / 2)
        const behindTargets = findArmorPiercingTargets(casterToken, token, splash)
        if (
          behindTargets.length > 0 &&
          splash > 0 &&
          confirm(
            `穿甲箭（重击）：对 ${token.label} 后方 15 尺通道内 ${behindTargets
              .map((t) => t.label)
              .join('、')} 各造成 ${splash} 点伤害（本次一半）？\n剩余 ${apTrait?.uses ?? 0} / ${apTrait?.maxUses ?? 0} 次`,
          )
        ) {
          useClassFeature(casterId, 'armorPiercingArrow')
          for (const behind of behindTargets) {
            await applyDamageToToken(behind, splash, { caster })
          }
          featureExtraLabelParts.push(`穿甲箭溅射${behindTargets.length}名目标，各${splash}`)
        }
      }
    }

    if (caster && skill.skillTreeId === 'windTraceShot' && skillRank >= 4 && isCalmMindActive(caster)) {
      selfCooldownReduction = Math.max(selfCooldownReduction, 1)
    }
    if (hit && caster && skill.skillTreeId === 'eagleStrike' && targetKnockedBeforeAttack) {
      selfCooldownReduction = Math.max(selfCooldownReduction, skillRank >= 4 ? 3 : 2)
    }

    if (!opts?.skipUseSkill) {
      const waiveAp = !!targeting?.waiveAp || !!caster?.combatBuffs?.galeComboReady
      useSkillStore(casterId, skill.id, waiveAp ? { waiveAp: true } : undefined)
      pushApLog(caster, waiveAp ? 0 : skill.apCost, `使用 ${skill.name}`, `目标 ${token.label}`)
      applySkillCooldownReduction(casterId, skill.id, selfCooldownReduction)
      if (waiveAp && caster?.combatBuffs?.galeComboReady) {
        useClassFeature(casterId, 'galeCombo')
        updateChar(casterId, {
          combatBuffs: { ...caster.combatBuffs, galeComboReady: undefined },
        })
      }
      if (caster && isBasicShot(skill) && caster.combatBuffs?.doubleArrowReady) {
        updateChar(casterId, {
          combatBuffs: { ...caster.combatBuffs, doubleArrowReady: undefined },
        })
      }
    }
    if (caster && tokenPatch.huntingMarkStacks === 4) {
      await triggerFinaleIfReady(caster, token)
    }
    const extraLabels = [...featureExtraLabelParts, enemyDodgeLabel, dexSaveLabel, stunSaveLabel].filter(Boolean).join(' · ')
    const finalLabel = extraLabels ? `${rollLabel} · ${extraLabels}` : rollLabel
    const diceFormula = values.length > 0 ? values.join(' + ') : '0'
    const fixedFormula = skill.damageBonus ? ` + ${skill.damageBonus}` : ''
    const beforeDefenseFormula =
      critFormulaLabel || skill.damageBonus || damageBeforeDefense !== values.reduce((sum, value) => sum + value, 0)
        ? ` = ${damageBeforeDefense}`
        : ''
    const attackDefenseFormula =
      attackDefenseDiff != null
        ? `，攻防修正 ${attackDefenseModifier >= 0 ? '+' : '-'}${Math.abs(attackDefenseModifier)}（差值${attackDefenseDiff}）`
        : ''
    const damageFormula =
      hit && values.length > 0
        ? `骰值 ${diceFormula}${fixedFormula}${critFormulaLabel}${beforeDefenseFormula}${attackDefenseFormula}，最终 ${total}`
        : undefined
    if (!opts?.silent) {
      const rollForDisplay: DiceRoll = {
        values: hit ? values : [],
        sides: isBasicShot(skill) ? 8 : skill.damageSides,
        bonus: damageBonusForRoll,
        total: hit ? total : 0,
        label: finalLabel,
        formula: damageFormula,
        targetName: token.label,
        d20Roll,
        diceBoxResolved: true,
      }
      setRoll(rollForDisplay)
      publishSharedDiceRoll(rollForDisplay)
      pushCombatLog(
        `${caster?.name ?? '角色'} 使用 ${skill.name} → ${token.label}：${finalLabel}。${hit ? `伤害 ${damageFormula ?? total}` : '未命中'}，最终 ${hit ? total : 0} 点。`,
        hit ? 'damage' : 'attack',
      )
      if (knockbackPending) {
        scheduleKnockbackRolls([knockbackPending])
      }
    }
    if (!opts?.skipCleanup) {
      setTargeting(null)
      setAoePreviewCell(null)
    }
    return {
      hit,
      total,
      values,
      rollLabel: finalLabel,
      d20Roll,
      knockbackPending,
      selfCooldownReduction,
    }
  }

  const resolveAoeAttack = async (clickedCell: GridCell) => {
    if (resolvingAoeRef.current) return
    if (!targeting?.aoe || !activeMap) return
    const { skill, casterId, aoe } = targeting
    const caster = characters.find((c) => c.id === casterId)
    const casterToken = activeMap.tokens.find((t) => t.characterId === casterId)
    if (!caster || !casterToken) return

    const casterCell = pixelToCell(casterToken.x, casterToken.y, activeMap)
    const anchorCell =
      aoe.shape === 'circle' && aoe.origin === 'self' ? casterCell : clickedCell
    if (!canPlaceAoe(aoe, casterCell, anchorCell)) {
      alert(
        aoe.shape === 'line'
          ? '瞄准点超出施法距离'
          : aoe.shape === 'rect'
            ? '矩形中心超出施法距离'
            : '圆心超出施法距离',
      )
      return
    }

    const cells = cellsForAoe(aoe, aoeOrientFromCell(aoe, casterCell, anchorCell), anchorCell)
    resolvingAoeRef.current = true
    setTargeting(null)
    setAoePreviewCell(null)
    if (skill.skillTreeId === 'focusShot') {
      launchArrowProjectile({ x: casterToken.x, y: casterToken.y }, cellToPixel(anchorCell, activeMap), 'focus')
    }
    const targets = tokensInCells(activeMap, activeMap.tokens, cells).filter(
      (t) => t.id !== casterToken.id,
    )
    if (targets.length === 0) {
      setRoll({
        values: [],
        sides: isBasicShot(skill) ? 8 : skill.damageSides,
        bonus: 0,
        total: 0,
        label: `${skill.name} · ${cells.length} 格 · 无目标`,
        targetName: '—',
      })
      resolvingAoeRef.current = false
      return
    }

    const hitLines: string[] = []
    const knockbackQueue: KnockbackPending[] = []
    let combinedValues: number[] = []
    let combinedTotal = 0
    let anyHit = false
    let selfCooldownReduction = 0
    const skillRank = getSkillRank(caster, skill.skillTreeId ?? '')
    const fallbackAoeDiceCount =
      skill.damageCount <= 0 && skill.skillTreeId === 'aerialCombo'
        ? Math.max(2, skillRank + 1)
        : skill.damageCount <= 0 && skill.skillTreeId === 'arrowStorm'
          ? Math.max(2, skillRank + 1)
          : 0
    const baseDiceCount = Math.max(attackDamageDiceCount(skill, false), fallbackAoeDiceCount)
    const damageSides = isBasicShot(skill) ? 8 : skill.damageSides
    let sharedValues = await rollDiceBoxValues(baseDiceCount, damageSides, `${skill.name} 伤害`, targets[0]?.label ?? skill.name)
    const sharedLabelParts: string[] = []
    const windExtra = windTraceExtraDiceCount(skill.skillTreeId, skillRank, caster, targets[0], targets.length)
    if (windExtra > 0) {
      const extraValues = await rollDiceBoxValues(windExtra, 6, `${skill.name} 额外伤害`, targets[0]?.label ?? skill.name)
      sharedValues = [...sharedValues, ...extraValues]
    }
    if (skill.skillTreeId === 'eagleStrike') {
      const eagleExtra = eagleStrikeExtraDiceCount(skillRank)
      if (eagleExtra > 0) {
        const extraValues = await rollDiceBoxValues(eagleExtra, 6, `${skill.name} 击飞伤害`, targets[0]?.label ?? skill.name)
        sharedValues = [...sharedValues, ...extraValues]
      }
    }
    const calm = findClassTrait(caster, 'calmMind')
    if (calm && isCalmMindActive(caster) && calm.level > 0) {
      const extra = await rollDiceBoxValues(calm.level, 6, `${skill.name} 静心额外伤害`, targets[0]?.label ?? skill.name)
      sharedValues = [...sharedValues, ...extra]
      sharedLabelParts.push(`静心+${calm.level}d6`)
    }

    for (const token of targets) {
      const result = await resolveAttack(token, {
        skipCleanup: true,
        skipUseSkill: true,
        silent: true,
        aoeTargetCount: targets.length,
        presetDamageValues: sharedValues,
        presetFeatureLabelParts: sharedLabelParts,
      })
      if (result) {
        anyHit = true
        combinedTotal += result.total
        selfCooldownReduction = Math.max(selfCooldownReduction, result.selfCooldownReduction ?? 0)
        const [, ...effectLabels] = result.rollLabel.split(' · ')
        hitLines.push(
          `${token.label} ${result.total}${effectLabels.length > 0 ? `（${effectLabels.join(' · ')}）` : ''}`,
        )
        if (result.knockbackPending) knockbackQueue.push(result.knockbackPending)
      }
    }
    combinedValues = anyHit ? sharedValues : []

    if (skill.skillTreeId === 'windTraceShot' && skillRank >= 4 && isCalmMindActive(caster)) {
      selfCooldownReduction = Math.max(selfCooldownReduction, 1)
    }

    const waiveAp = !!targeting?.waiveAp || !!caster?.combatBuffs?.galeComboReady
    useSkillStore(casterId, skill.id, waiveAp ? { waiveAp: true } : undefined)
    pushApLog(caster, waiveAp ? 0 : skill.apCost, `释放 ${skill.name}`, `${targets.length} 名目标，覆盖 ${cells.length} 格`)
    applySkillCooldownReduction(casterId, skill.id, selfCooldownReduction)
    if (waiveAp && caster?.combatBuffs?.galeComboReady) {
      useClassFeature(casterId, 'galeCombo')
      updateChar(casterId, {
        combatBuffs: { ...caster.combatBuffs, galeComboReady: undefined },
      })
    }

    const cellCount = cells.length
    setRoll({
      values: anyHit ? combinedValues : [],
      sides: isBasicShot(skill) ? 8 : skill.damageSides,
      bonus: combinedTotal - combinedValues.reduce((sum, value) => sum + value, 0),
      total: combinedTotal,
      diceBoxResolved: true,
      label: `${skill.name} · ${cellCount} 格 · ${targets.length} 名在范围内${anyHit ? '' : '（无命中）'}`,
      formula: anyHit
        ? `${combinedValues.join(' + ')}${combinedTotal - combinedValues.reduce((sum, value) => sum + value, 0) >= 0 ? ' + ' : ' - '}${Math.abs(combinedTotal - combinedValues.reduce((sum, value) => sum + value, 0))} = ${combinedTotal}`
        : undefined,
      targetName: hitLines.length > 0 ? hitLines.join('；') : '—',
    })
    pushCombatLog(
      `${caster.name} 结算 ${skill.name}：覆盖 ${cells.length} 格，${targets.length} 名目标在范围内。伤害骰 ${combinedValues.length > 0 ? combinedValues.join(' + ') : '无'}，加值/修正 ${combinedTotal - combinedValues.reduce((sum, value) => sum + value, 0)}，合计 ${combinedTotal}。${hitLines.length > 0 ? `逐个目标：${hitLines.join('；')}` : '无目标受击'}`,
      anyHit ? 'damage' : 'attack',
    )
    if (knockbackQueue.length > 0) {
      scheduleKnockbackRolls(knockbackQueue)
    }
    resolvingAoeRef.current = false
  }

  const applyDamageToToken = async (
    target: Token,
    amount: number,
    opts?: { damageType?: 'physical' | 'magic'; caster?: Character },
  ) => {
    if (!activeMap) return
    const damageType = opts?.damageType ?? 'physical'
    const attackerInput = opts?.caster ? characterToCombatInput(opts.caster) : undefined
    if (target.characterId) {
      const ch = useCharacterStore.getState().characters.find((c) => c.id === target.characterId)
      const finalAmount = ch
        ? applyAttackDefenseDamageModifier(
            amount,
            attackerInput,
            characterToCombatInput(ch),
            damageType,
          ).damage
        : amount
      damageChar(target.characterId, finalAmount)
      const updated = useCharacterStore.getState().characters.find((c) => c.id === target.characterId)
      if (updated) {
        const patch: Partial<Token> = { hp: updated.currentHp, maxHp: updated.maxHp }
        if (
          finalAmount > 0 &&
          opts?.caster &&
          huntingMarkTraitRank(opts.caster) > 0 &&
          isEnemyTarget(target)
        ) {
          patch.huntingMarkStacks = Math.min(4, (target.huntingMarkStacks ?? 0) + 1)
        }
        updateToken(activeMap.id, target.id, patch)
        if (opts?.caster && patch.huntingMarkStacks === 4) {
          await triggerFinaleIfReady(opts.caster, target)
        }
        if (updated.currentHp <= 0) {
          deferDeathHandling(target.id, target.characterId)
        }
      }
    } else if (target.maxHp != null) {
      const hp = Math.max(0, (target.hp ?? target.maxHp) - amount)
      const patch: Partial<Token> = { hp }
      if (
        amount > 0 &&
        opts?.caster &&
        huntingMarkTraitRank(opts.caster) > 0 &&
        isEnemyTarget(target)
      ) {
        patch.huntingMarkStacks = Math.min(4, (target.huntingMarkStacks ?? 0) + 1)
      }
      updateToken(activeMap.id, target.id, patch)
      if (opts?.caster && patch.huntingMarkStacks === 4) {
        await triggerFinaleIfReady(opts.caster, target)
      }
      if (hp <= 0) {
        deferDeathHandling(target.id)
      }
    }
  }

  const handleActivateFeature = async (key: ClassFeatureKey) => {
    if (!canControlPlayerTurn || !turnCharacter) return
    if (key === 'eagleEye') {
      const currentTrait = findClassTrait(turnCharacter, 'eagleEye')
      if (!currentTrait || currentTrait.uses <= 0) return
      if (!spendAP(turnCharacter.id, 1)) {
        alert('行动点不足（需要 1 AP）')
        return
      }
      pushApLog(turnCharacter, 1, '激活鹰眼')
      const ok = useCharacterStore.getState().activateEagleEye(turnCharacter.id)
      if (ok) {
        const updated = useCharacterStore.getState().characters.find((c) => c.id === turnCharacter.id)
        const trait = updated && findClassTrait(updated, 'eagleEye')
        if (trait) {
          alert(
            `鹰眼已激活：2 回合内敏捷 +${eagleEyeDexBonus(trait.level)}（调整值 +${Math.floor(eagleEyeDexBonus(trait.level) / 2)}）（剩余 ${trait.uses}/${trait.maxUses} 次/长休）`,
          )
        }
      }
      return
    }
    if (key === 'doubleArrow') {
      if (!canArmDoubleArrow(turnCharacter)) {
        alert('双箭本场次数已用完')
        return
      }
      const ready = !turnCharacter.combatBuffs?.doubleArrowReady
      if (ready && !spendAP(turnCharacter.id, 1)) {
        alert('行动点不足（需要 1 AP）')
        return
      }
      if (ready) pushApLog(turnCharacter, 1, '激活双箭')
      updateChar(turnCharacter.id, {
        combatBuffs: {
          ...turnCharacter.combatBuffs,
          doubleArrowReady: ready || undefined,
        },
      })
      const trait = findClassTrait(turnCharacter, 'doubleArrow')
      if (ready) {
        alert(
          `双箭已就绪：下次单箭射击将改为 2 支箭矢\n剩余 ${trait?.uses ?? 0} / ${trait?.maxUses ?? 0} 次`,
        )
      } else {
        alert('已取消双箭')
      }
      return
    }
    if (key === 'preciseStrike') {
      const trait = findClassTrait(turnCharacter, 'preciseStrike')
      if (!trait || trait.uses <= 0) {
        alert('精准打击本场次数已用完')
        return
      }
      const ready = !turnCharacter.combatBuffs?.preciseStrikeReady
      if (ready) {
        if (!spendAP(turnCharacter.id, 1)) {
          alert('行动点不足（需要 1 AP）')
          return
        }
        updateChar(turnCharacter.id, {
          combatBuffs: { ...turnCharacter.combatBuffs, preciseStrikeReady: true },
        })
        pushApLog(turnCharacter, 1, '准备精准打击')
        alert('精准打击已就绪：下一次攻击必定重击')
      } else {
        updateChar(turnCharacter.id, {
          combatBuffs: { ...turnCharacter.combatBuffs, preciseStrikeReady: undefined },
        })
        alert('已取消精准打击')
      }
      return
    }
    if (key === 'trackingArrow') {
      const trait = findClassTrait(turnCharacter, 'trackingArrow')
      if (!trait || trait.uses <= 0) return
      if (!spendAP(turnCharacter.id, 1)) return
      const target = chooseEnemyTokenByPrompt('追踪箭：给一个已带狩猎印记的目标额外 +1 层印记', (t) => (t.huntingMarkStacks ?? 0) > 0)
      if (!target || !activeMap) return
      useClassFeature(turnCharacter.id, 'trackingArrow')
      const nextStacks = Math.min(4, (target.huntingMarkStacks ?? 0) + 1)
      updateToken(activeMap.id, target.id, { huntingMarkStacks: nextStacks })
      if (nextStacks === 4) await triggerFinaleIfReady(turnCharacter, target)
      pushApLog(turnCharacter, 1, '激活追踪箭', `${target.label} 狩猎印记 +1`)
      return
    }
    if (key === 'shadowVeil') {
      const trait = findClassTrait(turnCharacter, 'shadowVeil')
      if (!trait || trait.uses <= 0) return
      if (!spendAP(turnCharacter.id, 1)) return
      const target = chooseEnemyTokenByPrompt('影遁之术：消耗目标 2 层狩猎印记，本回合对其攻击 +1D6', (t) => (t.huntingMarkStacks ?? 0) >= 2)
      if (!target || !activeMap) return
      useClassFeature(turnCharacter.id, 'shadowVeil')
      updateToken(activeMap.id, target.id, { huntingMarkStacks: Math.max(0, (target.huntingMarkStacks ?? 0) - 2) })
      updateChar(turnCharacter.id, {
        combatBuffs: { ...turnCharacter.combatBuffs, shadowVeilTargetId: target.id },
      })
      pushApLog(turnCharacter, 1, '激活影遁之术', `${target.label} 印记 -2，本回合攻击 +1D6`)
      return
    }
    if (key === 'stillWater') {
      const trait = findClassTrait(turnCharacter, 'stillWater')
      if (!trait) return
      if (!isCalmMindActive(turnCharacter)) {
        alert('心如止水需要处于静心状态时激活')
        return
      }
      if (!spendAP(turnCharacter.id, 1)) return
      if (!activeMap || !myPlayerToken) return
      const tempHp = trait.level * 10
      const casterToken = activeMap.tokens.find((t) => t.characterId === turnCharacter.id) ?? myPlayerToken
      const sourceCell = pixelToCell(casterToken.x, casterToken.y, activeMap)
      let affected = 0
      for (const allyToken of activeMap.tokens) {
        if (!allyToken.characterId || allyToken.type !== 'player') continue
        const ally = useCharacterStore.getState().characters.find((c) => c.id === allyToken.characterId)
        if (!ally || ally.currentHp <= 0) continue
        const allyCell = pixelToCell(allyToken.x, allyToken.y, activeMap)
        if (cellDistance(sourceCell, allyCell) > 3) continue
        updateChar(ally.id, {
          tempHp: Math.max(ally.tempHp ?? 0, tempHp),
          combatBuffs: {
            ...ally.combatBuffs,
            stillWaterBreathImmunityTurns: 2,
            stillWaterTempHpTurns: 10,
            outOfBreathTurns: undefined,
            calmMind: findClassTrait(ally, 'calmMind') ? true : ally.combatBuffs?.calmMind,
          },
        })
        affected++
      }
      pushApLog(turnCharacter, 1, '激活心如止水', `15尺内 ${affected} 名友方获得 ${tempHp} 临时生命，2回合免气喘`)
      return
    }
    if (key === 'finale') {
      const trait = findClassTrait(turnCharacter, 'finale')
      if (!trait || trait.uses <= 0) return
      const ready = !turnCharacter.combatBuffs?.finaleReady
      if (!ready) {
        updateChar(turnCharacter.id, {
          combatBuffs: { ...turnCharacter.combatBuffs, finaleReady: undefined },
        })
        pushCombatLog(`${turnCharacter.name} 取消曲终待触发`, 'turn')
        return
      }
      if (ready && !spendAP(turnCharacter.id, 1)) return
      pushApLog(turnCharacter, 1, '激活曲终', '等待下一名敌对生物狩猎印记叠至 4 层')
      useClassFeature(turnCharacter.id, 'finale')
      updateChar(turnCharacter.id, {
        combatBuffs: { ...turnCharacter.combatBuffs, finaleReady: true },
      })
      return
    }
    if (key === 'illusionDance') {
      const trait = findClassTrait(turnCharacter, 'illusionDance')
      if (!trait || trait.uses <= 0) return
      if (!spendAP(turnCharacter.id, 1)) return
      if (!spendQi(turnCharacter.id, 1)) {
        alert('气不足（需要 1 点气）')
        return
      }
      const target = chooseEnemyTokenByPrompt('迷幻舞步：选择一个可见敌人进行感知豁免')
      if (!target || !activeMap || !myPlayerToken) return
      useClassFeature(turnCharacter.id, 'illusionDance')
      const save = await resolveAbilitySave(turnCharacter, target, target.characterId ? characters.find((c) => c.id === target.characterId) : undefined, 'wis', '迷幻舞步感知豁免')
      if (!save.success) {
        const casterCell = pixelToCell(myPlayerToken.x, myPlayerToken.y, activeMap)
        const targetCell = pixelToCell(target.x, target.y, activeMap)
        const dx = Math.sign(targetCell.col - casterCell.col)
        const dy = Math.sign(targetCell.row - casterCell.row)
        updateToken(activeMap.id, target.id, {
          ...cellToPixel({ col: casterCell.col + dx * 2, row: casterCell.row + dy * 2 }, activeMap),
          noMoveTurns: 1,
        })
        addConditionToCharacter(target.characterId, NO_MOVE_STATUS_LABEL)
      }
      pushApLog(turnCharacter, 1, '激活迷幻舞步', abilitySaveLabel('感知豁免', save, '成功', '失败，被拉近且不能移动'))
      return
    }
    if (key === 'flexibleBody') {
      const trait = findClassTrait(turnCharacter, 'flexibleBody')
      if (!trait) return
      if (!spendAP(turnCharacter.id, 1)) return
      if (!spendQi(turnCharacter.id, 1)) {
        alert('气不足（需要 1 点气）')
        return
      }
      const bonus = 5 + (trait.level - 1) * 2
      updateChar(turnCharacter.id, {
        combatBuffs: { ...turnCharacter.combatBuffs, flexibleBodyBonus: bonus },
      })
      pushApLog(turnCharacter, 1, '激活灵活身躯', `下次闪避/敏捷豁免 +${bonus}`)
      return
    }
  }

  const areOpposedTokens = (a: Token, b: Token) =>
    (a.type === 'player' && b.type === 'enemy') || (a.type === 'enemy' && b.type === 'player')

  const getEnemyApState = (tokenId: string) =>
    enemyApByTokenRef.current[tokenId] ?? { current: 2, max: 2 }

  const spendEnemyAp = (tokenId: string, cost: number) => {
    const ap = getEnemyApState(tokenId)
    if (ap.current < cost) return false
    const nextAp = { ...ap, current: Math.max(0, ap.current - cost) }
    enemyApByTokenRef.current = { ...enemyApByTokenRef.current, [tokenId]: nextAp }
    setEnemyApByToken((current) => ({ ...current, [tokenId]: nextAp }))
    return true
  }

  const opportunityAttackersForMove = (
    movingToken: Token,
    to: { x: number; y: number },
    movingChar?: Character,
  ) => {
    if (!activeMap || (movingChar && disengagedCharIds.has(movingChar.id))) return [] as Token[]
    const fromCell = pixelToCell(movingToken.x, movingToken.y, activeMap)
    const toCell = pixelToCell(to.x, to.y, activeMap)
    return activeMap.tokens.filter((t) => {
      if (t.id === movingToken.id || !areOpposedTokens(t, movingToken)) return false
      if (!isTokenAlive(t, useCharacterStore.getState().characters)) return false
      if (t.characterId) {
        const attacker = useCharacterStore.getState().characters.find((c) => c.id === t.characterId)
        if (!attacker || attacker.currentAP < 1 || attacker.currentHp <= 0) return false
      } else if (t.type === 'enemy') {
        const ap = getEnemyApState(t.id)
        if (ap.current < 1) return false
      } else {
        return false
      }
      const attackerCell = pixelToCell(t.x, t.y, activeMap)
      return cellDistance(attackerCell, fromCell) <= 1 && cellDistance(attackerCell, toCell) > 1
    })
  }

  const resolveOpportunityAttack = async (
    attackerToken: Token,
    targetToken: Token,
    targetChar?: Character,
  ) => {
    if (!activeMap) return
    const attacker = attackerToken.characterId
      ? useCharacterStore.getState().characters.find((c) => c.id === attackerToken.characterId)
      : undefined
    if (attackerToken.characterId && (!attacker || attacker.currentAP < 1 || attacker.currentHp <= 0)) return
    if (!attackerToken.characterId && attackerToken.type === 'enemy') {
      const ap = getEnemyApState(attackerToken.id)
      if (ap.current < 1) return
    }
    const targetName = targetChar?.name ?? targetToken.label
    const attackerName = attacker?.name ?? attackerToken.label
    if (attacker &&
      !confirm(
        `${attackerName} 对 ${targetName} 触发借机攻击？\n消耗 1 AP，进行一次近战命中判定。`,
      )
    ) {
      return
    }
    if (attacker) {
      if (!spendAP(attacker.id, 1)) return
      pushApLog(attacker, 1, '借机攻击', `目标 ${targetName}`)
    } else {
      if (!spendEnemyAp(attackerToken.id, 1)) return
      pushCombatLog(`${attackerToken.label} 花费 1 AP：借机攻击 ${targetName}`, 'turn')
    }

    const d20 = await rollDiceBoxD20('借机攻击 D20', targetName)
    const attackBonus = attacker
      ? getEffectiveAbilityMod(attacker, 'str') + proficiencyBonus(attacker.level)
      : getTokenAbilityMod(attackerToken, 'str') + 2
    const targetAc = targetChar ? getAc(targetChar) : (getTokenTargetAc(targetToken) ?? 12)
    const hit = d20 + attackBonus >= targetAc || d20 >= 20
    const isCrit = d20 >= 20
    let values: number[] = []
    let total = 0
    let bonus = 0
    let formula: string | undefined
    if (hit) {
      values = await rollDiceBoxValues(1, 6, '借机攻击 伤害', targetName)
      const raw = values.reduce((sum, value) => sum + value, 0)
      const critRaw = isCrit
        ? Math.floor(raw * (attacker ? computeCritDamageMultiplier(characterToCombatInput(attacker)) : 1.25))
        : raw
      const adjusted = targetChar
        ? applyAttackDefenseDamageModifier(
            critRaw,
            attacker ? characterToCombatInput(attacker) : enemyCombatInput(attackerToken.poolId ?? ''),
            characterToCombatInput(targetChar),
            'physical',
          )
        : adjustDamageAgainstToken(critRaw, attacker ? characterToCombatInput(attacker) : enemyCombatInput(attackerToken.poolId ?? ''), targetToken, 'physical')
      total = adjusted.damage
      bonus = total - raw
      const critText = isCrit ? ` × 暴击${attacker ? formatCritDamagePercent(attacker) : '125%'}` : ''
      formula = `${values.join(' + ')}${critText}${isCrit ? ` = ${critRaw}` : ''} ${adjusted.modifier >= 0 ? '+' : '-'} ${Math.abs(adjusted.modifier)}攻防修正(差值${adjusted.diff}) = ${total}`
      if (total > 0) {
        if (targetChar) {
          damageChar(targetChar.id, total)
          const updated = useCharacterStore.getState().characters.find((c) => c.id === targetChar.id)
          if (updated) {
            updateToken(activeMap.id, targetToken.id, { hp: updated.currentHp, maxHp: updated.maxHp })
            if (updated.currentHp <= 0) deferDeathHandling(targetToken.id, targetChar.id)
          }
        } else if (targetToken.maxHp != null) {
          const hp = Math.max(0, (targetToken.hp ?? targetToken.maxHp) - total)
          updateToken(activeMap.id, targetToken.id, { hp })
          if (hp <= 0) deferDeathHandling(targetToken.id)
        }
      }
    }
    setRoll({
      values,
      sides: 6,
      bonus,
      total,
      label: `借机攻击 · ${d20}+${attackBonus} vs AC${targetAc}${isCrit ? ' 重击' : ''}${hit ? '' : ' 未中'}`,
      formula,
      targetName,
      d20Roll: {
        value: d20,
        modifier: attackBonus,
        ac: targetAc,
        hit,
        isCrit,
        source: 'dice-box',
      },
      diceBoxResolved: true,
    })
    pushCombatLog(
      `${attackerName} 借机攻击 ${targetName}：D20 ${d20} + ${attackBonus} = ${d20 + attackBonus} vs AC ${targetAc}，${hit ? '命中' : '未命中'}${formula ? `；伤害 ${formula}` : ''}；最终 ${total} 点伤害`,
      total > 0 ? 'damage' : 'attack',
    )
  }

  const resolveOpportunityAttacksForMove = async (
    movingToken: Token,
    to: { x: number; y: number },
    movingChar?: Character,
  ) => {
    const attackers = opportunityAttackersForMove(movingToken, to, movingChar)
    for (const attacker of attackers) {
      const latestTarget = movingChar
        ? useCharacterStore.getState().characters.find((c) => c.id === movingChar.id)
        : undefined
      if (movingChar && (!latestTarget || latestTarget.currentHp <= 0)) break
      if (!movingChar && !isTokenAlive(movingToken, useCharacterStore.getState().characters)) break
      await resolveOpportunityAttack(attacker, movingToken, latestTarget)
    }
  }

  const handleMoveSelect = async (point: { x: number; y: number }) => {
    if (!activeMap || targeting?.aoe) return

    if (agileLeapChar && agileLeapToken && agileLeapCircle) {
      const feet = agileLeapChar.combatBuffs!.agileLeapMoveFeet!
      const center = { x: agileLeapCircle.centerX, y: agileLeapCircle.centerY }
      const pos = snapToCellCenter(point.x, point.y, activeMap)
      if (!isWithinMovementRange(center, pos, feet, activeMap)) return
      updateToken(activeMap.id, agileLeapToken.id, pos)
      useClassFeature(agileLeapChar.id, 'agileLeap')
      pushApLog(agileLeapChar, 0, '灵巧跳跃移动', `移动至多 ${feet} 尺`)
      updateChar(agileLeapChar.id, {
        combatBuffs: { ...agileLeapChar.combatBuffs, agileLeapMoveFeet: undefined },
      })
      return
    }

    if (turnCharacter && myPlayerToken && calmSpiritMoveCircle) {
      const feet = turnCharacter.combatBuffs?.calmSpiritMoveFeet ?? 0
      const center = { x: calmSpiritMoveCircle.centerX, y: calmSpiritMoveCircle.centerY }
      const pos = snapToCellCenter(point.x, point.y, activeMap)
      if (!isWithinMovementRange(center, pos, feet, activeMap)) return
      updateToken(activeMap.id, myPlayerToken.id, pos)
      pushApLog(turnCharacter, 0, '安定心神移动', `移动至多 ${feet} 尺`)
      updateChar(turnCharacter.id, {
        combatBuffs: { ...turnCharacter.combatBuffs, calmSpiritMoveFeet: undefined },
      })
      setShowMoveRange(false)
      return
    }

    if (turnCharacter && myPlayerToken && freeMoveCircle) {
      const feet = turnCharacter.combatBuffs?.freeMoveFeet ?? 0
      const center = { x: freeMoveCircle.centerX, y: freeMoveCircle.centerY }
      const pos = snapToCellCenter(point.x, point.y, activeMap)
      if (!isWithinMovementRange(center, pos, feet, activeMap)) return
      await resolveOpportunityAttacksForMove(myPlayerToken, pos, turnCharacter)
      const latestMover = useCharacterStore.getState().characters.find((c) => c.id === turnCharacter.id)
      if (!latestMover || latestMover.currentHp <= 0) return
      updateToken(activeMap.id, myPlayerToken.id, pos)
      updateChar(turnCharacter.id, {
        combatBuffs: { ...turnCharacter.combatBuffs, freeMoveFeet: undefined },
      })
      pushApLog(turnCharacter, 0, '技能授予移动', `移动至多 ${feet} 尺`)
      setShowMoveRange(false)
      return
    }

    if (!myPlayerToken || !turnCharacter || !showMoveRange || !moveCircle) return
    if (turnCharacter.conditions.includes(NO_MOVE_STATUS_LABEL)) {
      alert('该角色本回合无法移动')
      return
    }
    const center = { x: moveCircle.centerX, y: moveCircle.centerY }
    const moveFeet = turnCharacter.speed
    const pos = snapToCellCenter(point.x, point.y, activeMap)
    if (!isWithinMovementRange(center, pos, moveFeet, activeMap)) return
    if (!spendAP(turnCharacter.id, 1)) return
    const fromCell = pixelToCell(myPlayerToken.x, myPlayerToken.y, activeMap)
    const toCell = pixelToCell(pos.x, pos.y, activeMap)
    const movedFeet = cellDistance(fromCell, toCell) * 5
    await resolveOpportunityAttacksForMove(myPlayerToken, pos, turnCharacter)
    const latestMover = useCharacterStore.getState().characters.find((c) => c.id === turnCharacter.id)
    if (!latestMover || latestMover.currentHp <= 0) return
    updateToken(activeMap.id, myPlayerToken.id, pos)
    pushApLog(turnCharacter, 1, '移动', `${movedFeet} 尺`)
    notifyCombatMove(turnCharacter.id)
    setShowMoveRange(false)
  }

  const handleDisengage = () => {
    if (!canControlPlayerTurn || !turnCharacter) return
    if (disengagedCharIds.has(turnCharacter.id)) return
    if (!spendAP(turnCharacter.id, 2)) {
      alert('行动点不足（撤离需 2 AP）')
      return
    }
    pushApLog(turnCharacter, 2, '撤离', '本回合移动不触发借机攻击')
    setDisengagedCharIds((prev) => new Set(prev).add(turnCharacter.id))
  }

  const spendCalmSpiritStacks = (amount: number): Character | null => {
    if (!canControlPlayerTurn || !turnCharacter) return null
    const latest = useCharacterStore.getState().characters.find((c) => c.id === turnCharacter.id)
    if (!latest || !findClassTrait(latest, 'calmSpirit')) return null
    const stacks = latest.combatBuffs?.calmSpiritStacks ?? 0
    if (stacks < amount) {
      alert(`静心标记不足（需要 ${amount} 枚）`)
      return null
    }
    updateChar(latest.id, {
      combatBuffs: {
        ...latest.combatBuffs,
        calmSpiritStacks: stacks - amount > 0 ? stacks - amount : undefined,
      },
    })
    pushCombatLog(`${latest.name} 消耗 ${amount} 枚静心标记。剩余 ${Math.max(0, stacks - amount)}/4`, 'turn')
    return latest
  }

  const handleCalmSpiritMove = () => {
    const ch = spendCalmSpiritStacks(1)
    const trait = ch && findClassTrait(ch, 'calmSpirit')
    if (!ch || !trait) return
    const feet = 10 + (trait.level - 1) * 5
    const latest = useCharacterStore.getState().characters.find((c) => c.id === ch.id) ?? ch
    updateChar(ch.id, {
      combatBuffs: {
        ...latest.combatBuffs,
        calmSpiritMoveFeet: feet,
      },
    })
    pushCombatLog(`${ch.name} 发动安定心神：可移动至多 ${feet} 尺且不失去静心`, 'turn')
    setShowMoveRange(true)
  }

  const handleCalmSpiritCrit = () => {
    const ch = spendCalmSpiritStacks(2)
    const trait = ch && findClassTrait(ch, 'calmSpirit')
    if (!ch || !trait) return
    const bonus = 20 + (trait.level - 1) * 10
    const latest = useCharacterStore.getState().characters.find((c) => c.id === ch.id) ?? ch
    updateChar(ch.id, {
      combatBuffs: { ...latest.combatBuffs, calmSpiritCritBonusPercent: bonus },
    })
    pushCombatLog(`${ch.name} 发动安定心神：下一次攻击暴击率 +${bonus}%`, 'turn')
  }

  const handleCalmSpiritCooldown = () => {
    const ch = useCharacterStore.getState().characters.find((c) => c.id === turnCharacter?.id)
    if (!ch) return
    const skills = ch.combatSkills.filter((s) => s.remaining > 0)
    if (skills.length === 0) {
      alert('没有正在冷却的技能')
      return
    }
    const picked = window.prompt(
      `选择要 CD -1 的技能编号：\n${skills
        .map((s, i) => `${i + 1}. ${s.name}（剩余 ${s.remaining}）`)
        .join('\n')}`,
    )
    const index = Number(picked) - 1
    const skill = skills[index]
    if (!skill) return
    const spent = spendCalmSpiritStacks(3)
    if (!spent) return
    const latest = useCharacterStore.getState().characters.find((c) => c.id === spent.id)
    if (!latest) return
    updateChar(spent.id, {
      combatSkills: latest.combatSkills.map((s) =>
        s.id === skill.id ? { ...s, remaining: Math.max(0, s.remaining - 1) } : s,
      ),
    })
    pushCombatLog(`${spent.name} 发动安定心神：${skill.name} CD -1`, 'turn')
  }

  const handleCalmSpiritExtraTurn = () => {
    const ch = spendCalmSpiritStacks(4)
    if (!ch) return
    const latest = useCharacterStore.getState().characters.find((c) => c.id === ch.id) ?? ch
    updateChar(ch.id, {
      currentAP: latest.actionPoints,
      combatSkills: latest.combatSkills.map((s) => ({ ...s, usedThisTurn: false })),
      combatBuffs: {
        ...latest.combatBuffs,
        calmSpiritStacks: undefined,
      },
    })
    pushCombatLog(`${ch.name} 发动安定心神：获得一个完整回合，AP 回满为 ${latest.actionPoints}/${latest.actionPoints}`, 'turn')
    alert('安定心神：已获得一个完整回合（AP 回满，技能本回合使用限制重置）')
  }

  const handleUseSkill = (skill: CombatSkill) => {
    if (!activeChar) return
    if (skill.skillTreeId === 'riseKick' && !activeChar.conditions.includes('倒地')) {
      alert('起身踢只能在倒地时使用')
      return
    }
    const waiveAp = !!activeChar.combatBuffs?.galeComboReady
    if (skill.damageCount > 0) {
      const doubleArrow =
        canUseDoubleArrow(activeChar, skill) && !!activeChar.combatBuffs?.doubleArrowReady
      const aoe = getSkillAoeTargeting(skill)
      setShowMoveRange(false)
      setAoePreviewCell(null)
      setTargeting({
        casterId: activeChar.id,
        skill,
        doubleArrow,
        aoe: aoe ?? undefined,
        waiveAp: waiveAp || undefined,
      })
      setAoeRectRotation(0)
      if (waiveAp) {
        alert('疾风连击已就绪：本次技能释放无需消耗 AP')
      }
    } else {
      useSkillStore(activeChar.id, skill.id, waiveAp ? { waiveAp: true } : undefined)
      pushApLog(activeChar, waiveAp ? 0 : skill.apCost, `使用 ${skill.name}`)
      if (waiveAp) {
        useClassFeature(activeChar.id, 'galeCombo')
        updateChar(activeChar.id, {
          combatBuffs: { ...activeChar.combatBuffs, galeComboReady: undefined },
        })
      }
    }
  }

  const handleAoePreviewCell = (cell: GridCell | null) => {
    if (!cell || !targeting?.aoe || !aoeUsesMouseAim(targeting.aoe)) return
    setAoePreviewCell(cell)
  }

  const handleAoeConfirm = (cell: GridCell) => {
    if (!targeting?.aoe || !aoeCasterCell) return
    if (isSelfOriginCircleAoe(targeting.aoe)) {
      void resolveAoeAttack(aoeCasterCell)
      return
    }
    if (!aoeHighlight?.valid) return
    void resolveAoeAttack(cell)
  }

  const handleSelectToken = (tokenId: string | null) => {
    if (!tokenId) {
      setSelectedTokenId(null)
      setSelectedCharacterTokenId(null)
      return
    }

    // 范围技能确认优先于移动
    if (targeting?.aoe && activeMap && aoeCasterCell) {
      if (isSelfOriginCircleAoe(targeting.aoe)) {
        const casterToken = activeMap.tokens.find((t) => t.characterId === targeting.casterId)
        if (casterToken && tokenId === casterToken.id) {
          resolveAoeAttack(aoeCasterCell)
          return
        }
      }
      setSelectedTokenId(tokenId)
      return
    }

    if (canControlPlayerTurn && tokenId === myPlayerToken?.id) {
      setActiveCharId(turnCharacter!.id)
      setShowMoveRange((v) => !v)
      setSelectedTokenId(tokenId)
      return
    }
    // 单体技能：点到 token 即结算
    if (targeting && !targeting.aoe) {
      const tok = activeMap?.tokens.find((t) => t.id === tokenId)
      if (tok) {
        const rangeFeet = singleTargetRangeFeet(targeting.skill)
        if (rangeFeet != null && activeMap) {
          const targetCell = pixelToCell(tok.x, tok.y, activeMap)
          const inRange = new Set(rangedRangeCells.map(cellKey)).has(cellKey(targetCell))
          if (!inRange) {
            alert(`目标超出射程（${rangeFeet} 尺）`)
            return
          }
        }
        if (targeting.skill.skillTreeId === 'multiShot' || targeting.skill.skillTreeId === 'rageShot') {
          const caster = characters.find((c) => c.id === targeting.casterId)
          if (caster && activeMap) {
            const shots = Math.max(1, targeting.skill.arrowShots ?? 1)
            const perArrowSkill: CombatSkill = { ...targeting.skill, arrowShots: 1 }
            const selectedTargets: Token[] = [tok]
            const candidates = activeMap.tokens.filter((t) => {
              if (t.characterId === targeting.casterId) return false
              if (!isTokenAlive(t, characters)) return false
              const targetCell = pixelToCell(t.x, t.y, activeMap)
              return new Set(rangedRangeCells.map(cellKey)).has(cellKey(targetCell))
            })
            for (let shot = 1; shot < shots; shot++) {
              const picked = candidates.length
                ? window.prompt(
                    `${targeting.skill.name}：选择第 ${shot + 1}/${shots} 支箭目标，留空则继续射向 ${tok.label}：\n${candidates
                      .map((t, i) => `${i + 1}. ${t.label}`)
                      .join('\n')}`,
                  )
                : null
              selectedTargets.push(candidates[Number(picked) - 1] ?? tok)
            }
            const waiveAp = !!targeting.waiveAp
            if (!waiveAp && caster.currentAP < targeting.skill.apCost) {
              alert(`行动点不足（需要 ${targeting.skill.apCost} AP）`)
              return
            }
            void (async () => {
              useSkillStore(caster.id, targeting.skill.id, waiveAp ? { waiveAp: true } : undefined)
              pushApLog(caster, waiveAp ? 0 : targeting.skill.apCost, `使用 ${targeting.skill.name}`, `${selectedTargets.length} 支箭`)
              if (waiveAp && caster.combatBuffs?.galeComboReady) {
                useClassFeature(caster.id, 'galeCombo')
                updateChar(caster.id, {
                  combatBuffs: { ...caster.combatBuffs, galeComboReady: undefined },
                })
              }
              for (const [i, target] of selectedTargets.entries()) {
                await resolveAttack(target, {
                  skipCleanup: true,
                  skipUseSkill: true,
                  silent: i > 0,
                  skillOverride: perArrowSkill,
                })
              }
              pushCombatLog(
                `${caster.name} 使用 ${targeting.skill.name}：${selectedTargets
                  .map((t, i) => `第${i + 1}支→${t.label}`)
                  .join('，')}`,
                'attack',
              )
              setTargeting(null)
              setAoePreviewCell(null)
            })()
            return
          }
        }
        /*
        if (false && targeting.skill.skillTreeId === 'rageShot') {
          const caster = characters.find((c) => c.id === targeting.casterId)
          const rank = caster ? getSkillRank(caster, 'rageShot') : 0
          if (rank >= 4 && activeMap) {
            const candidates = activeMap.tokens.filter(
              (t) => t.id !== tok.id && t.characterId !== targeting.casterId && isTokenAlive(t, characters),
            )
            const picked = candidates.length > 0
              ? window.prompt(
                  `怒气爆射可额外选择 1 名目标，输入编号；留空跳过：\n${candidates
                    .map((t, i) => `${i + 1}. ${t.label}`)
                    .join('\n')}`,
                )
              : null
            const extra = candidates[Number(picked) - 1]
            void (async () => {
              await resolveAttack(tok, { skipCleanup: true })
              if (extra) {
                await resolveAttack(extra, {
                  skipCleanup: true,
                  skipUseSkill: true,
                  silent: true,
                })
                pushCombatLog(`${targeting.skill.name} 额外目标：${extra.label} 已结算`, 'damage')
              }
              setTargeting(null)
              setAoePreviewCell(null)
            })()
            return
          }
        }
        */
        void resolveAttack(tok)
        return
      }
    }
    const tok = activeMap?.tokens.find((t) => t.id === tokenId)
    if (tok?.characterId) {
      setActiveCharId(tok.characterId)
      setSelectedCharacterTokenId(tokenId)
    }
    if (tok?.type === 'enemy') {
      setSelectedTokenId(tokenId)
    }
    if (!isDM && tok?.type === 'enemy' && tok.showDetailOnToken !== false) {
      setEnemyDetailOpen(true)
    }
  }

  const openEnemyPool = (mode: 'add' | 'apply') => {
    setEnemyPoolMode(mode)
    setEnemyPoolOpen(true)
  }

  const handleEnemyPoolPick = (template: EnemyTemplate) => {
    if (!activeMap) return
    const patch = enemyTemplateToTokenPatch(template)
    if (enemyPoolMode === 'add') {
      const id = addEnemyFromPool(activeMap.id, template)
      if (id) setSelectedTokenId(id)
      return
    }
    if (selectedToken?.type === 'enemy') {
      updateToken(activeMap.id, selectedToken.id, patch)
    }
  }

  const handleRedetectGrid = async () => {
    if (!activeMap || gridDetecting) return
    setGridDetecting(true)
    try {
      const blob = await getImage(activeMap.id)
      if (!blob) return
      const result = await detectGridFromBlob(blob)
      updateMap(activeMap.id, applyGridDetectPatch(result))
    } finally {
      setGridDetecting(false)
    }
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      void (async () => {
        const gridDetect = await detectImageGrid(img)
        await addMap({
          name: file.name.replace(/\.[^.]+$/, ''),
          width: img.naturalWidth,
          height: img.naturalHeight,
          blob: file,
          gridDetect,
        })
        URL.revokeObjectURL(objectUrl)
        setSelectedTokenId(null)
      })()
    }
    img.src = objectUrl
    e.target.value = ''
  }

  const ensureInitiativeVisible = (index: number, scroll: number) => {
    if (index < scroll) return index
    if (index >= scroll + INITIATIVE_VISIBLE_MAX) return Math.max(0, index - INITIATIVE_VISIBLE_MAX + 1)
    return scroll
  }

  useEffect(() => {
    setInitiativeScroll((s) => ensureInitiativeVisible(initiativeIndex, s))
  }, [initiativeIndex, initiativeOrder.length])

  const clearEnemyTurnTimers = () => {
    for (const id of enemyTurnTimersRef.current) window.clearTimeout(id)
    enemyTurnTimersRef.current = []
  }

  const startCombat = () => {
    if (!activeMap) return
    clearEnemyTurnTimers()
    setCombatLog([])
    setCombatLogOpen(true)
    enemyAppliedKeysRef.current.clear()
    playerTurnStartedRef.current.clear()
    multiStrikeHitsRef.current = {}
    setDisengagedCharIds(new Set())
    clearPlayerCombatUI()
    const order = buildInitiativeOrder(activeMap.tokens, characters)
    const charIds = new Set<string>()
    for (const entry of order) {
      const tok = activeMap.tokens.find((t) => t.id === entry.tokenId)
      if (tok?.characterId) charIds.add(tok.characterId)
    }
    const shouldClearStatuses =
      isDM && window.confirm('开始战斗前是否清除当前地图所有参战单位的状态？')
    if (shouldClearStatuses) {
      for (const token of activeMap.tokens) {
        updateToken(activeMap.id, token.id, TOKEN_STATUS_CLEAR_PATCH)
      }
      for (const cid of charIds) {
        updateChar(cid, { conditions: [], combatBuffs: {}, tempHp: 0 })
      }
    }
    for (const cid of charIds) resetCombatCooldowns(cid)
    const initialEnemyAp: Record<string, { current: number; max: number }> = {}
    for (const token of activeMap.tokens) {
      if (token.type === 'enemy') initialEnemyAp[token.id] = { current: 2, max: 2 }
    }
    enemyApByTokenRef.current = initialEnemyAp
    setEnemyApByToken(initialEnemyAp)
    setCombatActive(true)
    setRound(1)
    setInitiativeOrder(order)
    initiativeOrderRef.current = order
    setInitiativeIndex(0)
    initiativeIndexRef.current = 0
    setInitiativeScroll(0)
    publishCombatState({
      active: true,
      round: 1,
      initiativeIndex: 0,
      initiativeOrder: order,
      enemyApByToken: initialEnemyAp,
    })
    pushCombatLog(`战斗开始：${order.length} 名单位加入先攻`, 'system', 1)
  }

  const endCombat = () => {
    pushCombatLog('战斗结束', 'system')
    clearEnemyTurnTimers()
    setDodgePrompt(null)
    afterRollRef.current = null
    setRoll(null)
    setCombatActive(false)
    setInitiativeOrder([])
    initiativeOrderRef.current = []
    setInitiativeIndex(0)
    initiativeIndexRef.current = 0
    setInitiativeScroll(0)
    enemyAppliedKeysRef.current.clear()
    playerTurnStartedRef.current.clear()
    multiStrikeHitsRef.current = {}
    setDisengagedCharIds(new Set())
    clearPlayerCombatUI()
    enemyApByTokenRef.current = {}
    setEnemyApByToken({})
    publishCombatState({
      active: false,
      round,
      initiativeIndex: 0,
      initiativeOrder: [],
      enemyApByToken: {},
    })
  }

  const tryEndCombatIfNeeded = (): boolean => {
    if (!combatActive || !activeMap) return false
    if (pendingDeathKeysRef.current.size > 0) return false
    const chars = useCharacterStore.getState().characters
    const outcome = checkCombatOutcome(activeMap.tokens, chars)
    if (!outcome.ended) return false
    window.alert(outcome.message)
    endCombat()
    return true
  }

  const resolveAttackTargetCharacter = (
    token: Token | undefined,
    chars: Character[],
    hintedCharacterId?: string,
  ): Character | undefined => {
    if (hintedCharacterId) {
      const byHint = chars.find((c) => c.id === hintedCharacterId)
      if (byHint) return byHint
    }
    if (token?.characterId) {
      return chars.find((c) => c.id === token.characterId)
    }
    return undefined
  }

  const finishEnemyAttack = async (
    result: EnemyTurnResult,
    targetChar: Character | undefined,
    wantsDodge: boolean | null,
    providedDodgeD20?: number,
    dodgeApAlreadySpent = false,
  ) => {
    if (!activeMap || !result.attacked || !result.targetTokenId) return

    const DEFAULT_AOE_SAVE_DC = 13
    let combatLabel = ''
    let d20Roll:
      | {
          value: number
          modifier: number
          ac: number
          hit: boolean
          kind?: 'dodge' | 'save'
          source?: 'dice-box'
        }
      | undefined
    let damageRollValues = result.attack?.values ?? []
    let damageRollTotal = result.attack?.total ?? 0
    let damageRollBonus = result.attack?.bonus ?? 0
    let damageDiceResolved = false
    const enemyFeatureLabels: string[] = []

    const resolveEnemyDamageDice = async () => {
      if (!result.attack || result.damage == null || result.damage <= 0) {
        return result.damage ?? 0
      }
      const diceCount = Math.max(1, result.attack.values.length || 1)
      let values = await rollDiceBoxValues(
        diceCount,
        result.attack.sides,
        `${result.attack.label} 伤害`,
        result.attack.targetName,
      )
      const attackerToken = activeMap.tokens.find((t) => t.id === result.attackerTokenId)
      const huntedByTargetRank = huntingMarkTraitRank(targetChar)
      if (
        attackerToken &&
        (attackerToken.huntingMarkStacks ?? 0) > 0 &&
        huntedByTargetRank > 0
      ) {
        const markValues = await rollDiceBoxValues(
          huntedByTargetRank,
          4,
          '狩猎印记反噬伤害',
          result.attack.targetName,
        )
        values = [...values, ...markValues]
        enemyFeatureLabels.push(`狩猎印记反噬+${huntedByTargetRank}d4`)
      }
      damageRollValues = values
      const diceTotal = values.reduce((sum, value) => sum + value, 0)
      let rawDamage = diceTotal + result.attack.bonus
      const attackerInput = attackerToken?.poolId ? enemyCombatInput(attackerToken.poolId) : undefined
      if (attackerInput && targetChar) {
        const adjusted = applyAttackDefenseDamageModifier(
          rawDamage,
          attackerInput,
          characterToCombatInput(targetChar),
          'physical',
        )
        rawDamage = adjusted.damage
        damageRollBonus = rawDamage - diceTotal
        enemyFeatureLabels.push(`攻防修正${adjusted.modifier >= 0 ? '+' : ''}${adjusted.modifier}(差值${adjusted.diff})`)
      } else {
        damageRollBonus = result.attack.bonus
      }
      damageRollTotal = Math.max(0, rawDamage)
      damageDiceResolved = true
      return damageRollTotal
    }

    const syncTargetHp = (charId: string) => {
      const updated = useCharacterStore.getState().characters.find((c) => c.id === charId)
      if (updated) {
        updateToken(activeMap.id, result.targetTokenId!, {
          hp: updated.currentHp,
          maxHp: updated.maxHp,
        })
        if (updated.currentHp <= 0) {
          deferDeathHandling(result.targetTokenId!, charId)
        }
      }
    }

    const applyFullDamage = (charId: string, amount: number) => {
      if (amount <= 0) return
      const before = useCharacterStore.getState().characters.find((c) => c.id === charId)
      const surge = before ? findClassTrait(before, 'arcaneSurge') : undefined
      if (before && surge && surge.uses > 0 && before.currentHp > 0 && before.currentHp - amount <= 0) {
        if (window.confirm(`魔法浪涌：${before.name} 将受到致命伤害。是否消耗 1 次使用，把生命改为 1？`)) {
          useClassFeature(before.id, 'arcaneSurge')
          updateChar(before.id, { currentHp: 1 })
          syncTargetHp(before.id)
          combatLabel = `${combatLabel ? `${combatLabel} · ` : ''}魔法浪涌：生命保留为 1`
          return
        }
      }
      let after = before
      if (before) {
        let remaining = amount
        const beforeTemp = before.tempHp ?? 0
        const nextTemp = Math.max(0, beforeTemp - remaining)
        remaining = Math.max(0, remaining - beforeTemp)
        const nextHp = Math.max(0, before.currentHp - remaining)
        updateChar(charId, {
          tempHp: nextTemp,
          currentHp: nextHp,
          combatBuffs: {
            ...triggerOutOfBreath(before, 'damage'),
            tookDamageThisTurn: true,
          },
        })
        after = useCharacterStore.getState().characters.find((c) => c.id === charId)
      }
      syncTargetHp(charId)
      if (before && after) {
        enemyFeatureLabels.push(
          `HP ${before.currentHp}/${before.maxHp} → ${after.currentHp}/${after.maxHp}` +
            ((before.tempHp ?? 0) !== (after.tempHp ?? 0)
              ? `，临时生命 ${before.tempHp ?? 0} → ${after.tempHp ?? 0}`
              : ''),
        )
      }
    }

    const applyTokenDamage = (amount: number) => {
      if (!activeMap || !result.targetTokenId || amount <= 0) return
      const target = activeMap.tokens.find((t) => t.id === result.targetTokenId)
      if (!target || target.maxHp == null) return
      const hp = Math.max(0, (target.hp ?? target.maxHp) - amount)
      updateToken(activeMap.id, target.id, { hp })
      if (hp <= 0) deferDeathHandling(target.id)
    }

    const hasEnemyDamage = !!result.attack || (result.damage != null && result.damage > 0)

    if (targetChar && hasEnemyDamage) {
      const damageType = result.damageType ?? 'physical'

      if (damageType === 'aoe') {
        const estimatedDamage = Math.max(1, result.damage ?? result.attack?.total ?? 0)
        const resolved = resolveIncomingDexSaveDamage(
          targetChar,
          estimatedDamage,
          result.saveDC ?? DEFAULT_AOE_SAVE_DC,
          () => {
            if (!spendAP(targetChar.id, 1)) return false
            pushApLog(targetChar, 1, '残影脱身', '抵消敏捷豁免后仍会受到的伤害')
            return useClassFeature(targetChar.id, 'stableMind')
          },
        )
        combatLabel = formatDexSaveLabel(resolved)
        d20Roll = {
          value: resolved.saveD20,
          modifier: resolved.saveMod,
          ac: resolved.dc,
          hit: resolved.success,
          kind: 'save',
        }
        if (resolved.finalDamage > 0) {
          applyFullDamage(targetChar.id, resolved.finalDamage)
        }
      } else if (wantsDodge != null) {
        const estimatedDamage = Math.max(1, result.damage ?? result.attack?.total ?? 0)
        const flexibleBonus = targetChar.combatBuffs?.flexibleBodyBonus ?? 0
        const dodgeTarget = flexibleBonus > 0 ? { ...targetChar, ac: targetChar.ac + flexibleBonus } : targetChar
        const canResolveDodge = wantsDodge && (dodgeApAlreadySpent || canAttemptDodge(targetChar))
        const dodgeD20 =
          canResolveDodge
            ? providedDodgeD20 ?? (await rollDiceBoxD20('D20', targetChar.name))
            : undefined
        const resolved = resolvePhysicalEnemyHit(
          dodgeTarget,
          estimatedDamage,
          wantsDodge,
          () => {
            if (dodgeApAlreadySpent) return true
            const spent = spendAP(targetChar.id, 1)
            if (spent) {
              const attackerName =
                activeMap.tokens.find((t) => t.id === result.attackerTokenId)?.label ?? '敌人'
              pushApLog(targetChar, 1, '尝试闪避', `应对 ${attackerName} 的攻击`)
            }
            return spent
          },
          undefined,
          dodgeD20,
        )
        if (flexibleBonus > 0 && wantsDodge) {
          updateChar(targetChar.id, {
            combatBuffs: { ...targetChar.combatBuffs, flexibleBodyBonus: undefined },
          })
        }
        combatLabel = flexibleBonus > 0 && wantsDodge ? `${resolved.combatLabel} · 灵活身躯+${flexibleBonus}` : resolved.combatLabel
        if (resolved.dodgeRoll) {
          d20Roll = {
            value: resolved.dodgeRoll.d20,
            modifier: resolved.dodgeRoll.attackBonus,
            ac: resolved.dodgeRoll.targetAc,
            hit: !resolved.dodged,
            kind: 'dodge',
            source: 'dice-box',
          }
        }
        if (!resolved.dodged && resolved.damageDealt > 0) {
          const pendingDamage = await resolveEnemyDamageDice()
          applyFullDamage(targetChar.id, pendingDamage)
        }
        if (resolved.dodged) {
          damageRollValues = []
          damageRollTotal = 0
          const leap = offerAgileLeap(targetChar)
          if (leap.accepted) {
            updateChar(targetChar.id, {
              combatBuffs: { ...targetChar.combatBuffs, agileLeapMoveFeet: leap.feet },
            })
            combatLabel += ` · 灵巧跳跃：点击地图移动至多 ${leap.feet} 尺`
          }
        }
      }
    } else if (result.targetCharacterId != null && hasEnemyDamage) {
      const pendingDamage = await resolveEnemyDamageDice()
      applyFullDamage(result.targetCharacterId, pendingDamage)
      const fallback = useCharacterStore.getState().characters.find((c) => c.id === result.targetCharacterId)
      if (fallback && fallback.currentHp <= 0 && result.targetTokenId) {
        deferDeathHandling(result.targetTokenId, result.targetCharacterId)
      }
    } else if (!targetChar && hasEnemyDamage) {
      const pendingDamage = await resolveEnemyDamageDice()
      applyTokenDamage(pendingDamage)
    } else if (result.targetTokenPatch) {
      updateToken(activeMap.id, result.targetTokenId, result.targetTokenPatch)
      if (result.targetTokenPatch.hp != null && result.targetTokenPatch.hp <= 0 && result.targetTokenId) {
        deferDeathHandling(result.targetTokenId)
      }
    }
    if (result.attack) {
      const labelParts = [combatLabel, ...enemyFeatureLabels].filter(Boolean)
      const attackLabel = labelParts.length > 0
        ? `${result.attack.label} · ${labelParts.join(' · ')}`
        : result.attack.label
      const enemyRollForDisplay: DiceRoll = {
        values: damageRollValues,
        sides: result.attack.sides,
        bonus: damageRollBonus,
        total: damageRollTotal,
        label: attackLabel,
        formula:
          damageRollValues.length > 0
            ? `${damageRollValues.join(' + ')}${damageRollBonus >= 0 ? ' + ' : ' - '}${Math.abs(damageRollBonus)} = ${damageRollTotal}`
            : undefined,
        targetName: result.attack.targetName,
        d20Roll,
        diceBoxResolved: damageDiceResolved,
      }
      setRoll(enemyRollForDisplay)
      publishSharedDiceRoll(enemyRollForDisplay)
      pushCombatLog(
        `${result.attack.label} → ${result.attack.targetName}：伤害骰 ${damageRollValues.length > 0 ? damageRollValues.join(' + ') : '无'}，加值 ${damageRollBonus}，最终 ${damageRollTotal} 点${combatLabel ? `；${combatLabel}` : ''}`,
        damageRollTotal > 0 ? 'damage' : 'attack',
      )
    }
  }

  const applyEnemyAttack = (result: EnemyTurnResult, onComplete: () => void) => {
    if (!activeMap || !result.attacked || !result.targetTokenId) {
      onComplete()
      return
    }

    const chars = useCharacterStore.getState().characters
    const targetToken = activeMap.tokens.find((t) => t.id === result.targetTokenId)
    const targetChar = resolveAttackTargetCharacter(targetToken, chars, result.targetCharacterId)
    const targetAlive =
      !targetChar ||
      (targetChar.currentHp > 0 &&
        !pendingDeathKeysRef.current.has(`${result.targetTokenId}:${targetChar.id}`))
    if (targetChar && !targetAlive) {
      onComplete()
      return
    }
    const damageType = result.damageType ?? 'physical'
    const canDodge =
      !!targetChar &&
      damageType !== 'aoe' &&
      result.damage != null &&
      result.damage > 0 &&
      canAttemptDodge(targetChar)

    if (canDodge) {
      if (isDM && activeMap) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        pendingSharedDodgeRef.current = { id, result, targetCharId: targetChar!.id, onComplete }
        void saveSharedResource<SharedDodgeState>('dodge', {
          id,
          mapId: activeMap.id,
          status: 'pending',
          result,
          targetCharId: targetChar!.id,
          updatedAt: Date.now(),
        })
        return
      }
      setDodgePrompt({ result, targetChar: targetChar!, onComplete })
      return
    }

    const autoAccept =
      !!targetChar && damageType !== 'aoe' && result.damage != null && result.damage > 0
    void finishEnemyAttack(result, targetChar, autoAccept ? false : null).then(onComplete)
  }

  const handleDodgeChoice = (wantsDodge: boolean) => {
    if (!dodgePrompt) return
    const { result, targetChar, onComplete } = dodgePrompt
    const latest = useCharacterStore.getState().characters.find((c) => c.id === targetChar.id)
    if (
      !latest ||
      latest.currentHp <= 0 ||
      pendingDeathKeysRef.current.has(`${result.targetTokenId}:${targetChar.id}`)
    ) {
      onComplete()
      return
    }
    let dodgeApSpent = false
    if (wantsDodge) {
      if (!canAttemptDodge(latest)) {
        alert('行动点不足，无法尝试闪避。')
        return
      }
      const spent = spendAP(latest.id, 1)
      if (!spent) {
        alert('行动点不足，无法尝试闪避。')
        return
      }
      const attackerName = activeMap?.tokens.find((t) => t.id === result.attackerTokenId)?.label ?? '敌人'
      pushApLog(latest, 1, '尝试闪避', `应对 ${attackerName} 的攻击`)
      dodgeApSpent = true
    }
    setDodgePrompt(null)
    void finishEnemyAttack(result, latest, wantsDodge, undefined, dodgeApSpent).then(onComplete)
  }

  const handleSharedDodgeChoice = async (wantsDodge: boolean) => {
    if (!sharedDodgePrompt || !activeMap) return
    const prompt = sharedDodgePrompt
    const latestTarget =
      useCharacterStore.getState().characters.find((c) => c.id === prompt.targetChar.id) ?? prompt.targetChar
    let dodgeApSpent = false
    if (wantsDodge) {
      if (!canAttemptDodge(latestTarget)) {
        alert('行动点不足，无法尝试闪避。')
        return
      }
      const spent = spendAP(latestTarget.id, 1)
      if (!spent) {
        alert('行动点不足，无法尝试闪避。')
        return
      }
      const attackerName = activeMap.tokens.find((t) => t.id === prompt.result.attackerTokenId)?.label ?? '敌人'
      pushApLog(latestTarget, 1, '尝试闪避', `应对 ${attackerName} 的攻击`)
      dodgeApSpent = true
    }
    suppressedDodgePromptIdsRef.current.add(prompt.id)
    setSharedDodgePrompt(null)
    if (wantsDodge) {
      void saveSharedResource<SharedDodgeState>('dodge', {
        id: prompt.id,
        mapId: activeMap.id,
        status: 'rolling',
        result: prompt.result,
        targetCharId: latestTarget.id,
        wantsDodge,
        dodgeApSpent,
        updatedAt: Date.now(),
      })
    }
    const dodgeD20 =
      wantsDodge && dodgeApSpent
        ? await rollDiceBoxD20('闪避判定 D20', latestTarget.name)
        : undefined
    if (dodgeD20 != null) {
      publishSharedDiceRoll({
        values: [],
        sides: 20,
        bonus: 0,
        total: 0,
        label: '闪避判定',
        targetName: latestTarget.name,
        d20Roll: {
          value: dodgeD20,
          modifier: ENEMY_MELEE_ATTACK_BONUS,
          ac: latestTarget.ac,
          hit: dodgeD20 + ENEMY_MELEE_ATTACK_BONUS >= latestTarget.ac,
          kind: 'dodge',
        },
      })
    }
    void saveSharedResource<SharedDodgeState>('dodge', {
      id: prompt.id,
      mapId: activeMap.id,
      status: 'answered',
      result: prompt.result,
      targetCharId: latestTarget.id,
      wantsDodge,
      dodgeD20,
      dodgeApSpent,
      updatedAt: Date.now(),
    })
  }

  const scheduleEnemyTurn = async (enemy: Token) => {
    if (!activeMap) return
    const enemyTurnKey = `${round}-${initiativeIndex}-${enemy.id}`
    const advanceEnemyIfCurrent = () => {
      const current = initiativeOrderRef.current[initiativeIndexRef.current]
      if (!current || current.tokenId !== enemy.id) return
      if (!enemyAppliedKeysRef.current.has(enemyTurnKey)) return
      advanceInitiativeCore()
    }
    const startingAp = getEnemyApState(enemy.id).current
    if (startingAp <= 0) {
      const id = window.setTimeout(advanceEnemyIfCurrent, 300)
      enemyTurnTimersRef.current.push(id)
      return
    }
    const result = planEnemyTurn(activeMap, enemy, useCharacterStore.getState().characters, startingAp, { round })
    if (result.newPosition) {
      const moveApSpent = result.moveApSpent ?? 1
      await resolveOpportunityAttacksForMove(enemy, result.newPosition)
      const latestMap = useMapStore.getState().maps.find((m) => m.id === activeMap.id)
      const latestEnemy = latestMap?.tokens.find((t) => t.id === enemy.id) ?? enemy
      if (!isTokenAlive(latestEnemy, useCharacterStore.getState().characters)) {
        const id = window.setTimeout(advanceEnemyIfCurrent, DICE_ROLL_MS + 200)
        enemyTurnTimersRef.current.push(id)
        return
      }
      updateToken(activeMap.id, enemy.id, { x: result.newPosition.x, y: result.newPosition.y })
      spendEnemyAp(enemy.id, moveApSpent)
      pushCombatLog(`${enemy.label} 花费 ${moveApSpent} AP：移动。剩余 AP ${getEnemyApState(enemy.id).current}/2`, 'turn')
    }

    const pushTimer = (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms)
      enemyTurnTimersRef.current.push(id)
    }

    if (!result.attacked) {
      pushTimer(advanceEnemyIfCurrent, result.moved ? TOKEN_MOVE_MS : 400)
      return
    }

    const attack = () => {
      if (!spendEnemyAp(enemy.id, 1)) {
        pushTimer(advanceEnemyIfCurrent, 300)
        return
      }
      const remainingAp = getEnemyApState(enemy.id).current
      const targetName =
        activeMap.tokens.find((t) => t.id === result.targetTokenId)?.label ??
        result.attack?.targetName ??
        '目标'
      pushCombatLog(
        `${enemy.label} 花费 1 AP：攻击 ${targetName}。剩余 AP ${remainingAp}/2`,
        'turn',
      )
      applyEnemyAttack(result, () => {
        const apLeft = getEnemyApState(enemy.id).current
        const latestMap = useMapStore.getState().maps.find((m) => m.id === activeMap.id)
        const latestEnemy = latestMap?.tokens.find((t) => t.id === enemy.id)
        if (apLeft > 0 && latestMap && latestEnemy && isTokenAlive(latestEnemy, useCharacterStore.getState().characters)) {
          const nextResult = planEnemyTurn(latestMap, latestEnemy, useCharacterStore.getState().characters, apLeft, { round })
          if (nextResult.attacked && !nextResult.newPosition && spendEnemyAp(enemy.id, 1)) {
            pushTimer(() => {
              const nextRemainingAp = getEnemyApState(enemy.id).current
              const nextTargetName =
                latestMap.tokens.find((t) => t.id === nextResult.targetTokenId)?.label ??
                nextResult.attack?.targetName ??
                '目标'
              pushCombatLog(
                `${enemy.label} 花费 1 AP：继续攻击 ${nextTargetName}。剩余 AP ${nextRemainingAp}/2`,
                'turn',
              )
              applyEnemyAttack(nextResult, () => {
                pushTimer(advanceEnemyIfCurrent, DICE_ROLL_MS + 200)
              })
              return
            }, DICE_ROLL_MS + 5000)
            return
          }
        }
        pushTimer(advanceEnemyIfCurrent, DICE_ROLL_MS + 200)
      })
    }

    if (result.moved) {
      pushTimer(attack, TOKEN_MOVE_MS)
    } else {
      attack()
    }
  }

  const nextRound = () => {
    if (activeMap) {
      for (const t of activeMap.tokens) {
        const patch: Partial<Token> = {}
        let charConds: string[] | null = null
        const ch = t.characterId
          ? useCharacterStore.getState().characters.find((c) => c.id === t.characterId)
          : null
        if (ch) charConds = [...ch.conditions]

        if (t.burningTurns && t.burningTurns > 0) {
          patch.burningTurns = t.burningTurns - 1
          if (patch.burningTurns === 0 && charConds) {
            charConds = charConds.filter((c) => c !== STATUS_LABEL.burning)
          }
        }
        if (t.igniteTurns && t.igniteTurns > 0) {
          patch.igniteTurns = t.igniteTurns - 1
          if (patch.igniteTurns === 0 && charConds) {
            charConds = charConds.filter((c) => c !== IGNITE_STATUS_LABEL)
          }
        }
        if (t.poisonTurns && t.poisonTurns > 0) {
          patch.poisonTurns = t.poisonTurns - 1
          if (patch.poisonTurns === 0 && charConds) {
            charConds = charConds.filter((c) => c !== STATUS_LABEL.poison)
          }
        }
        if (t.knockbackTurns && t.knockbackTurns > 0) {
          patch.knockbackTurns = t.knockbackTurns - 1
          if (patch.knockbackTurns === 0 && charConds) {
            charConds = charConds.filter((c) => c !== KNOCKBACK_STATUS_LABEL)
          }
        }
        if (t.stunTurns && t.stunTurns > 0) {
          patch.stunTurns = t.stunTurns - 1
          if (patch.stunTurns === 0 && charConds) {
            charConds = charConds.filter((c) => c !== STUN_STATUS_LABEL)
          }
        }
        if (t.restrainedTurns && t.restrainedTurns > 0) {
          patch.restrainedTurns = t.restrainedTurns - 1
          if (patch.restrainedTurns === 0 && charConds) {
            charConds = charConds.filter((c) => c !== RESTRAINED_STATUS_LABEL)
          }
        }
        if (t.vulnerableTurns && t.vulnerableTurns > 0) {
          patch.vulnerableTurns = t.vulnerableTurns - 1
          if (patch.vulnerableTurns === 0 && charConds) {
            charConds = charConds.filter((c) => c !== VULNERABLE_STATUS_LABEL)
          }
        }
        if (t.noMoveTurns && t.noMoveTurns > 0) {
          patch.noMoveTurns = t.noMoveTurns - 1
          if (patch.noMoveTurns === 0 && charConds) {
            charConds = charConds.filter((c) => c !== NO_MOVE_STATUS_LABEL)
          }
        }

        if (Object.keys(patch).length > 0) {
          updateToken(activeMap.id, t.id, patch)
        }
        if (t.characterId && ch && charConds && charConds.length !== ch.conditions.length) {
          updateChar(t.characterId, { conditions: charConds })
        }
      }
      if (round === 1) {
        const charIds = new Set(
          activeMap.tokens
            .map((token) => token.characterId)
            .filter((id): id is string => !!id),
        )
        const chars = useCharacterStore.getState().characters
        for (const charId of charIds) {
          const ch = chars.find((c) => c.id === charId)
          if (ch && findClassTrait(ch, 'silentDraw') && !ch.combatBuffs?.silentDrawUsed) {
            updateChar(charId, {
              combatBuffs: { ...ch.combatBuffs, silentDrawUsed: true },
            })
          }
        }
      }
    }
    const next = round + 1
    const nextCharacters = resetRoundApForActiveMap('next-round')
    const nextEnemyAp: Record<string, { current: number; max: number }> = {}
    for (const token of activeMap.tokens) {
      if (token.type === 'enemy' && isTokenAlive(token, nextCharacters)) {
        nextEnemyAp[token.id] = { current: 2, max: 2 }
      }
    }
    enemyApByTokenRef.current = nextEnemyAp
    setEnemyApByToken(nextEnemyAp)
    pushCombatLog(`进入第 ${next} 回合`, 'turn', next)
    setRound(next)
  }

  const advanceInitiativeCore = () => {
    const order = initiativeOrderRef.current
    if (order.length === 0) return
    const chars = useCharacterStore.getState().characters
    const idx = initiativeIndexRef.current
    const current = order[idx]
    if (!current) {
      setInitiativeIndex(0)
      initiativeIndexRef.current = 0
      return
    }

    const curToken = activeMap?.tokens.find((t) => t.id === current.tokenId)
    if (curToken?.characterId) endTurn(curToken.characterId)
    let next = idx + 1
    while (next < order.length) {
      const entry = order[next]
      const tok = activeMap?.tokens.find((t) => t.id === entry.tokenId)
      if (!tok) {
        setInitiativeOrder((o) => {
          const pruned = pruneInitiativeForToken(o, idx, entry.tokenId)
          initiativeIndexRef.current = pruned.index
          initiativeOrderRef.current = pruned.order
          setInitiativeIndex(pruned.index)
          return pruned.order
        })
        window.setTimeout(() => advanceInitiativeCore(), 0)
        return
      }
      if (!isTokenAlive(tok, chars)) {
        next += 1
        continue
      }
      break
    }

    if (tryEndCombatIfNeeded()) return

    if (next >= order.length) {
      nextRound()
      setInitiativeIndex(0)
      initiativeIndexRef.current = 0
      setInitiativeScroll(0)
    } else {
      setInitiativeIndex(next)
      initiativeIndexRef.current = next
    }
  }

  const advanceInitiative = () => {
    if (isEnemyTurn) return
    if (advancingTurnRef.current) return
    advancingTurnRef.current = true
    advanceInitiativeCore()
    window.setTimeout(() => {
      advancingTurnRef.current = false
    }, 350)
  }

  useEffect(() => {
    if (!combatActive || !activeMap || initiativeOrder.length === 0) return

    const entry = initiativeOrder[initiativeIndex]
    if (!entry) {
      advanceInitiativeCore()
      return
    }

    const token = activeMap.tokens.find((t) => t.id === entry.tokenId)
    const chars = useCharacterStore.getState().characters

    if (!token) {
      setInitiativeOrder((order) => {
        const pruned = pruneInitiativeForToken(order, initiativeIndexRef.current, entry.tokenId)
        initiativeIndexRef.current = pruned.index
        initiativeOrderRef.current = pruned.order
        setInitiativeIndex(pruned.index)
        return pruned.order
      })
      const timer = window.setTimeout(() => advanceInitiativeCore(), 50)
      return () => window.clearTimeout(timer)
    }

    if (!isTokenAlive(token, chars)) {
      const timer = window.setTimeout(() => advanceInitiativeCore(), 50)
      return () => window.clearTimeout(timer)
    }

    if (!isDM || !isEnemyTurn || !currentInitiativeToken) return

    const actKey = `${round}-${initiativeIndex}-${currentInitiativeToken.id}`
    if (enemyAppliedKeysRef.current.has(actKey)) return

    enemyAppliedKeysRef.current.add(actKey)
    scheduleEnemyTurn(currentInitiativeToken)
  }, [combatActive, initiativeIndex, round, activeMap?.id, currentInitiativeToken?.id, isDM])

  useEffect(() => {
    if (!canControlPlayerTurn) {
      clearPlayerCombatUI()
      return
    }
    if (!turnCharacter?.id || currentInitiativeToken?.type !== 'player') return
    const key = `turn-${round}-${initiativeIndex}-${currentInitiativeToken.id}`
    const latest = useCharacterStore.getState().characters.find((c) => c.id === turnCharacter.id)
    if (latest?.combatBuffs?.turnStartKey === key) {
      setActiveCharId(turnCharacter.id)
      return
    }
    if (playerTurnStartedRef.current.has(key)) return
    playerTurnStartedRef.current.add(key)
    beginTurn(turnCharacter.id)
    const afterBegin = useCharacterStore.getState().characters.find((c) => c.id === turnCharacter.id)
    if (afterBegin) {
      updateChar(turnCharacter.id, {
        combatBuffs: {
          ...afterBegin.combatBuffs,
          turnStartKey: key,
        },
      })
    }
    setActiveCharId(turnCharacter.id)
  }, [canControlPlayerTurn, turnCharacter?.id, round, initiativeIndex, currentInitiativeToken?.id, currentInitiativeToken?.type])

  useEffect(() => {
    if (!combatActive || !activeMap || !currentInitiativeToken) return
    if (tryEndCombatIfNeeded()) return
    if (!isTokenAlive(currentInitiativeToken, characters)) {
      const timer = window.setTimeout(() => advanceInitiativeCore(), 50)
      return () => window.clearTimeout(timer)
    }
  }, [combatActive, activeMap?.id, currentInitiativeToken?.id, characters, defeatedTokenIds.length])

  const handlePlayerEndTurn = (event?: React.MouseEvent) => {
    event?.stopPropagation()
    if (advancingTurnRef.current) return
    clearPlayerCombatUI()
    setTargeting(null)
    setAoePreviewCell(null)
    setAoeRectRotation(0)
    setShowMoveRange(false)
    setDodgePrompt(null)

    if (combatActive && canControlPlayerTurn && turnCharacter) {
      for (const key of Object.keys(multiStrikeHitsRef.current)) {
        if (key.startsWith(`${turnCharacter.id}:`)) delete multiStrikeHitsRef.current[key]
      }
      setDisengagedCharIds((prev) => {
        if (!prev.has(turnCharacter.id)) return prev
        const next = new Set(prev)
        next.delete(turnCharacter.id)
        return next
      })
      advanceInitiative()
      return
    }
    if (activeChar) endTurn(activeChar.id)
  }

  const ModeToggle = forcedMode ? null : (
    <div className="flex items-center rounded-lg bg-void-900/60 p-0.5">
      <button
        onClick={() => chooseMode('player')}
        className={[
          'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
          mode === 'player' ? 'bg-arcane-500/30 text-arcane-100' : 'text-slate-400 hover:text-slate-200',
        ].join(' ')}
      >
        <User className="h-3.5 w-3.5" />
        玩家
      </button>
      <button
        onClick={() => chooseMode('dm')}
        className={[
          'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
          mode === 'dm' ? 'bg-ember-500/30 text-ember-400' : 'text-slate-400 hover:text-slate-200',
        ].join(' ')}
      >
        <Crown className="h-3.5 w-3.5" />
        DM
      </button>
    </div>
  )

  if (!mode) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-void-950 px-4">
        <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-void-900/80 p-6 shadow-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-arcane-300">Stars Battle Map</p>
          <h1 className="mt-3 text-2xl font-bold text-slate-100">选择进入模式</h1>
          <p className="mt-2 text-sm text-slate-400">
            DM 端负责地图、怪物、状态、血量和障碍物；玩家端只显示玩家可见的战斗信息和操作。
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => chooseMode('dm')}
              className="rounded-xl border border-ember-400/30 bg-ember-500/15 px-4 py-5 text-left hover:bg-ember-500/25"
            >
              <Crown className="mb-3 h-6 w-6 text-ember-300" />
              <p className="font-bold text-ember-100">DM 界面</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">管理地图、怪物详情、状态、血量、网格和障碍物。</p>
            </button>
            <button
              type="button"
              onClick={() => chooseMode('player')}
              className="rounded-xl border border-arcane-400/30 bg-arcane-500/15 px-4 py-5 text-left hover:bg-arcane-500/25"
            >
              <User className="mb-3 h-6 w-6 text-arcane-200" />
              <p className="font-bold text-arcane-100">玩家界面</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">只显示玩家操作、可见角色、战斗 Log 和可见怪物信息。</p>
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full w-full">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

      {maps.length === 0 || !activeMap ? (
        <div className="flex h-full flex-col">
          <div className="mb-4">{ModeToggle}</div>
          <div className="flex flex-1 items-center">
            <div className="w-full">
              <EmptyState
                icon={MapIcon}
                title="还没有地图"
                description="上传一张图片作为战斗地图，之后可以叠加网格、放置 token、开始战斗。"
                hint="支持 PNG / JPG · 图片本地存储，刷新不丢失"
                action={
                  isDM ? (
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="flex items-center gap-2 rounded-xl bg-arcane-500/20 px-4 py-2 text-sm font-semibold text-arcane-200 transition-colors hover:bg-arcane-500/30"
                    >
                      <Upload className="h-4 w-4" />
                      选择图片上传
                    </button>
                  ) : undefined
                }
              />
            </div>
          </div>
        </div>
      ) : (
        /* 全屏地图框，所有控件作为浮层 */
        <div ref={frameRef} className="relative h-full w-full overflow-hidden rounded-2xl">
          {/* 地图本体铺满 */}
          <div className="absolute inset-0">
            <MapCanvas
              map={activeMap}
              selectedTokenId={selectedTokenId}
              onSelectToken={handleSelectToken}
              isDM={isDM}
              measureMode={isDM && measureMode && !targeting && !showMoveRange && !gridAdjustMode}
              hpByToken={hpByToken}
              tokenBadges={tokenBadges}
              tokenHoverLabels={tokenHoverLabels}
              projectiles={projectiles}
              defeatedTokenIds={defeatedTokenIds}
              builtinGrid={!!activeMap.builtinGridDetected}
              moveSelectMode={inMoveSelectMode && !!activeMoveCircle && !targeting?.aoe}
              moveCircle={activeMoveCircle}
              onMoveSelect={handleMoveSelect}
              aoeSelectMode={!!targeting?.aoe}
              aoeHighlight={aoeHighlight}
              rangedRangeCells={rangedRangeCells}
              onAoePreviewCell={handleAoePreviewCell}
              onAoeConfirm={handleAoeConfirm}
              onAoeCancel={() => {
                setTargeting(null)
                setAoePreviewCell(null)
              }}
              onBlankContextMenu={() => {
                setSelectedTokenId(null)
                setSelectedCharacterTokenId(null)
                setEnemyDetailOpen(false)
                setActiveCharId(null)
                setCharPanel(null)
              }}
              lockDragTokenIds={
                agileLeapToken && canAgileLeapMove
                  ? [agileLeapToken.id]
                  : targeting?.aoe
                    ? (activeMap.tokens
                        .filter((t) => t.characterId === targeting.casterId)
                        .map((t) => t.id) ?? [])
                    : myPlayerToken && canControlPlayerTurn
                      ? [myPlayerToken.id]
                      : []
              }
              gridAdjustMode={isDM && gridAdjustMode}
              onGridOffsetChange={(offsetX, offsetY) =>
                updateMap(activeMap.id, { gridOffsetX: offsetX, gridOffsetY: offsetY })
              }
              gridSizePreview={isDM && gridSizePreview}
              onGridSizeChange={(gridSize) =>
                updateMap(activeMap.id, { gridSize: clampGridSize(gridSize, activeMap) })
              }
            />
          </div>

          {isDM && gridAdjustMode && (
            <div className="pointer-events-none absolute left-1/2 top-[5.25rem] z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-amber-400/35 bg-void-950/90 px-3 py-1.5 text-xs text-amber-100 shadow-xl backdrop-blur-sm">
              <Move className="h-3.5 w-3.5 shrink-0" />
              <span>
                拖拽平移网格 · 滚轮缩放格子 · Shift+滚轮 ±3px · 方向键微调 · 偏移 ({activeMap.gridOffsetX},{activeMap.gridOffsetY}) · {activeMap.gridSize}px
              </span>
            </div>
          )}

          {/* 选择目标提示 */}
          {targeting && (
            <div className="absolute left-1/2 top-14 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-rose-400/40 bg-void-950/85 px-4 py-2 text-sm shadow-2xl backdrop-blur-sm">
              <span className="text-2xl">{targeting.skill.emoji}</span>
              <span className="text-slate-200">
                释放{' '}
                <span className="font-semibold text-rose-300">
                  {targeting.skill.name}
                  {targeting.doubleArrow ? '（双箭 ×2）' : ''}
                </span>{' '}
                —{' '}
                {targeting.aoe ? (
                  <>
                    {formatAoeHint(targeting.skill, targeting.aoe)}
                    {aoeHighlight && (
                      <span className="text-rose-200/90">
                        {' '}
                        · 高亮 {aoeHighlight.cells.length} 格
                      </span>
                    )}
                    {aoeConfirmHint(targeting.aoe, aoeHighlight?.valid ?? false)}
                  </>
                ) : (
                  '点击地图上的目标'
                )}
              </span>
              <button
                onClick={() => {
                  setTargeting(null)
                  setAoePreviewCell(null)
                }}
                className="rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
              >
                取消
              </button>
            </div>
          )}

          {/* 骰子飞入动画 */}
          {dodgePrompt && (
            <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm">
              <div
                role="dialog"
                aria-labelledby="dodge-prompt-title"
                className="mx-4 w-full max-w-md rounded-2xl border border-sky-400/35 bg-void-950/95 p-5 shadow-2xl"
              >
                <h3 id="dodge-prompt-title" className="text-lg font-semibold text-sky-100">
                  闪避
                </h3>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-300">
                  {formatDodgePrompt(dodgePrompt.targetChar)}
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => handleDodgeChoice(false)}
                    className="rounded-lg border border-slate-600/60 bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700/80"
                  >
                    承受伤害
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDodgeChoice(true)}
                    className="rounded-lg bg-sky-500/25 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-500/35"
                  >
                    尝试闪避
                  </button>
                </div>
              </div>
            </div>
          )}

          {sharedDodgePrompt && (
            <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm">
              <div
                role="dialog"
                aria-labelledby="shared-dodge-prompt-title"
                className="mx-4 w-full max-w-md rounded-2xl border border-sky-400/35 bg-void-950/95 p-5 shadow-2xl"
              >
                <h3 id="shared-dodge-prompt-title" className="text-lg font-semibold text-sky-100">
                  闪避
                </h3>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-300">
                  {formatDodgePrompt(sharedDodgePrompt.targetChar)}
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => handleSharedDodgeChoice(false)}
                    className="rounded-lg border border-slate-600/60 bg-slate-800/80 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700/80"
                  >
                    承受伤害
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSharedDodgeChoice(true)}
                    className="rounded-lg bg-sky-500/25 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-500/35"
                  >
                    尝试闪避
                  </button>
                </div>
              </div>
            </div>
          )}

          {(combatActive || combatLog.length > 0) && (
            <div className="absolute bottom-3 right-3 z-40 flex max-w-[calc(100%-1.5rem)] flex-col items-end">
              {combatLogOpen ? (
                <div className="w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/10 bg-void-950/90 shadow-2xl backdrop-blur-md">
                  <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
                    <Swords className="h-4 w-4 text-amber-200" />
                    <span className="text-sm font-bold text-slate-100">战斗 Log</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-300">
                      {combatLog.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCombatLog([])}
                      className="ml-auto rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-white/10 hover:text-slate-200"
                    >
                      清空
                    </button>
                    <button
                      type="button"
                      onClick={() => setCombatLogOpen(false)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-slate-100"
                      title="隐藏战斗 Log"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto px-2 py-2">
                    {combatLog.length === 0 ? (
                      <p className="px-2 py-5 text-center text-xs text-slate-500">暂无战斗记录</p>
                    ) : (
                      <div className="space-y-1.5">
                        {combatLog.map((entry) => {
                          const tone =
                            entry.kind === 'damage'
                              ? 'border-rose-400/25 bg-rose-500/10 text-rose-100'
                              : entry.kind === 'attack'
                                ? 'border-sky-400/25 bg-sky-500/10 text-sky-100'
                                : entry.kind === 'turn'
                                  ? 'border-amber-400/25 bg-amber-500/10 text-amber-100'
                                  : 'border-white/10 bg-white/[0.04] text-slate-200'
                          return (
                            <div key={entry.id} className={`rounded-lg border px-2 py-1.5 ${tone}`}>
                              <div className="mb-0.5 flex items-center gap-2 text-[10px] font-semibold text-slate-400">
                                <span className="tabular-nums">R{entry.round}</span>
                                <span className="tabular-nums">{entry.time}</span>
                              </div>
                              <p className="text-xs leading-snug">{entry.text}</p>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCombatLogOpen(true)}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-void-950/88 px-3 py-2 text-xs font-bold text-slate-200 shadow-xl backdrop-blur-md hover:bg-white/10"
                >
                  <Swords className="h-3.5 w-3.5 text-amber-200" />
                  Log
                  {combatLog.length > 0 && (
                    <span className="rounded-full bg-amber-500/25 px-1.5 py-0.5 text-[10px] tabular-nums text-amber-100">
                      {combatLog.length}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}

          {roll && <DiceRollOverlay roll={roll} onDone={handleRollDone} />}
          {(sharedDicePreview?.kind === 'd20' || !!diceBoxD20) && <DiceBoxD20Overlay
            key={
              sharedDicePreview?.kind === 'd20'
                ? `shared-d20-${sharedDicePreview.id}`
                : diceBoxD20
                  ? `local-d20-${diceBoxD20.id}`
                  : 'idle-d20'
            }
            active
            label={sharedDicePreview?.kind === 'd20' ? sharedDicePreview.label : diceBoxD20?.label ?? 'D20'}
            targetName={sharedDicePreview?.kind === 'd20' ? sharedDicePreview.targetName : diceBoxD20?.targetName ?? ''}
            value={sharedDicePreview?.kind === 'd20' ? sharedDicePreview.values?.[0] : diceBoxD20?.value}
            diceSeed={sharedDicePreview?.kind === 'd20' ? sharedDicePreview.diceSeed : diceBoxD20?.diceSeed}
            traceFrames={sharedDicePreview?.kind === 'd20' ? sharedDicePreview.traceFrames : undefined}
            replayLive={sharedDicePreview?.kind === 'd20' ? sharedDicePreview.replayLive : false}
            liveFrame={sharedDicePreview?.kind === 'd20' ? sharedDicePreview.liveFrame : undefined}
            liveFrameSeq={sharedDicePreview?.kind === 'd20' ? sharedDicePreview.liveFrameSeq : undefined}
            requestId={
              sharedDicePreview?.kind === 'd20'
                ? sharedDicePreview.animationSeed ?? sharedDicePreview.id
                : diceBoxD20?.animationSeed
            }
            flyIndex={sharedDicePreview?.kind === 'd20' ? sharedDicePreview.flyIndex : diceBoxD20?.flyIndex}
              onFrame={(requestId, frame, index) => {
                if (!diceBoxD20 || requestId !== diceBoxD20.animationSeed) return
                const lastIndex = lastPublishedDiceFrameRef.current.get(requestId) ?? -10
                if (index - lastIndex < 2 && index !== 0) return
                lastPublishedDiceFrameRef.current.set(requestId, index)
                publishDiceStream({ type: 'frame', requestId, kind: 'd20', frame, index })
              }}
            onComplete={(value, _traceFrames) => {
              if (sharedDicePreview?.kind === 'd20') {
                const id = sharedDicePreview.id
                window.setTimeout(() => {
                  setSharedDicePreview((current) => (current?.id === id ? null : current))
                }, 1000)
                return
              }
              if (diceBoxD20) {
                const request = diceBoxD20
                publishDiceStream({
                  type: 'complete',
                  requestId: request.animationSeed ?? request.diceSeed ?? String(request.id),
                  kind: 'd20',
                  value,
                })
                lastPublishedDiceFrameRef.current.delete(request.animationSeed ?? request.diceSeed ?? String(request.id))
                request.resolve(value)
                window.setTimeout(() => {
                  setDiceBoxD20((current) => (current?.id === request.id ? null : current))
                }, 600)
              }
            }}
          />}
          {sharedDicePreview?.kind === 'dice' && (
            <DiceBoxRollOverlay
              key={sharedDicePreview.id}
              count={sharedDicePreview.count}
              sides={sharedDicePreview.sides}
              label={sharedDicePreview.label}
              targetName={sharedDicePreview.targetName}
              values={sharedDicePreview.values}
              traceFrames={sharedDicePreview.traceFrames}
              replayLive={sharedDicePreview.replayLive}
              liveFrame={sharedDicePreview.liveFrame}
              liveFrameSeq={sharedDicePreview.liveFrameSeq}
              requestId={sharedDicePreview.animationSeed ?? sharedDicePreview.id}
              flyIndex={sharedDicePreview.flyIndex}
              showHud={false}
              onComplete={() => {
                const id = sharedDicePreview.id
                window.setTimeout(() => {
                  setSharedDicePreview((current) => (current?.id === id ? null : current))
                }, 3000)
              }}
            />
          )}
          {diceBoxRoll && (
            <DiceBoxRollOverlay
              key={diceBoxRoll.id}
              count={diceBoxRoll.count}
              sides={diceBoxRoll.sides}
              label={diceBoxRoll.label}
              targetName={diceBoxRoll.targetName}
              values={diceBoxRoll.values}
              requestId={diceBoxRoll.animationSeed}
              flyIndex={diceBoxRoll.flyIndex}
              showHud={false}
              onFrame={(requestId, frame, index) => {
                if (!diceBoxRoll || requestId !== diceBoxRoll.animationSeed) return
                const lastIndex = lastPublishedDiceFrameRef.current.get(requestId) ?? -10
                if (index - lastIndex < 2 && index !== 0) return
                lastPublishedDiceFrameRef.current.set(requestId, index)
                publishDiceStream({ type: 'frame', requestId, kind: 'dice', frame, index })
              }}
              onComplete={(values) => {
                const request = diceBoxRoll
                publishDiceStream({
                  type: 'complete',
                  requestId: request.animationSeed ?? String(request.id),
                  kind: 'dice',
                  value: values[0] ?? 1,
                  values,
                })
                lastPublishedDiceFrameRef.current.delete(request.animationSeed ?? String(request.id))
                request.resolve(request.values.length > 0 ? request.values : values)
                window.setTimeout(() => {
                  setDiceBoxRoll((current) => (current?.id === request.id ? null : current))
                }, 3000)
              }}
            />
          )}
          {/* T-P2-398 (398-A): player self-render of the broadcast result. The
              overlays @-relabel to the decided values; no frames, no seed. */}
          {rollRequestPreview?.kind === 'd20' && (
            <DiceBoxD20Overlay
              key={`rr-d20-${rollRequestPreview.id}`}
              active
              label={rollRequestPreview.label}
              targetName={rollRequestPreview.targetName}
              value={rollRequestPreview.values[0]}
              requestId={rollRequestPreview.id}
              onComplete={() => {
                const id = rollRequestPreview.id
                window.setTimeout(() => {
                  setRollRequestPreview((current) => (current?.id === id ? null : current))
                }, 800)
              }}
            />
          )}
          {rollRequestPreview?.kind === 'dice' && (
            <DiceBoxRollOverlay
              key={`rr-dice-${rollRequestPreview.id}`}
              count={rollRequestPreview.count}
              sides={rollRequestPreview.sides}
              label={rollRequestPreview.label}
              targetName={rollRequestPreview.targetName}
              values={rollRequestPreview.values}
              requestId={rollRequestPreview.id}
              showHud={false}
              onComplete={() => {
                const id = rollRequestPreview.id
                window.setTimeout(() => {
                  setRollRequestPreview((current) => (current?.id === id ? null : current))
                }, 1500)
              }}
            />
          )}

          {/* 先攻（控制栏隐藏时单独置顶） */}
          {combatActive && initiativeOrder.length > 0 && !showBar && (
            <div className="absolute inset-x-0 top-2 z-30 flex justify-center px-2">
              <InitiativeTracker
                entries={initiativeOrder}
                activeIndex={initiativeIndex}
                scrollOffset={initiativeScroll}
                round={round}
                hpByToken={hpByToken}
                apByToken={apByToken}
                defeatedTokenIds={defeatedTokenIds}
                onScroll={setInitiativeScroll}
                onSelect={(tokenId) => handleSelectToken(tokenId)}
              />
            </div>
          )}

          {/* 顶部控件浮层（可隐藏）；先攻叠在控制栏下方避免遮挡 */}
          {showBar ? (
            <div className="absolute inset-x-2 top-2 z-30 flex flex-col items-center gap-2">
            <div className="glass flex w-full flex-wrap items-center gap-2 rounded-xl px-2 py-1.5 shadow-xl">
              {ModeToggle}

              {/* 战斗状态 + 控制 */}
              <div
                className={[
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold',
                  combatActive ? 'bg-rose-500/15 text-rose-200' : 'bg-white/5 text-slate-400',
                ].join(' ')}
              >
                <Swords className="h-3.5 w-3.5" />
                {combatActive ? `第 ${round} 回合` : '未开始'}
              </div>
              {isDM &&
                (combatActive ? (
                  <>
                    <button
                      onClick={advanceInitiative}
                      disabled={initiativeOrder.length === 0 || isEnemyTurn}
                      className="flex items-center gap-1 rounded-lg bg-arcane-500/25 px-2.5 py-1 text-xs font-semibold text-arcane-100 hover:bg-arcane-500/40 disabled:cursor-not-allowed disabled:opacity-40"
                      title={isEnemyTurn ? '敌人回合中，行动结束后自动推进' : undefined}
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                      {isEnemyTurn ? '敌人行动中…' : '下一位'}
                    </button>
                    <button
                      onClick={endCombat}
                      className="flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-white/10"
                    >
                      <Square className="h-3.5 w-3.5" />
                      结束
                    </button>
                  </>
                ) : (
                  <button
                    onClick={startCombat}
                    className="flex items-center gap-1 rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 px-2.5 py-1 text-xs font-semibold text-white"
                  >
                    <Play className="h-3.5 w-3.5" />
                    开始战斗
                  </button>
                ))}

              {/* 玩家：结束自己的回合 */}
              {!isDM && (
                <button
                  onClick={handlePlayerEndTurn}
                  disabled={!canControlPlayerTurn || !turnCharacter}
                  className={[
                    'flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors',
                    activeChar
                      ? 'bg-arcane-500/25 text-arcane-100 hover:bg-arcane-500/40'
                      : 'cursor-not-allowed bg-white/5 text-slate-600',
                  ].join(' ')}
                  title={activeChar ? `结束 ${activeChar.name} 的回合：冷却 -1、行动点回满` : '先选择你的角色'}
                >
                  <SkipForward className="h-3.5 w-3.5" />
                  结束回合
                </button>
              )}

              {/* DM 工具 */}
              {isDM && (
                <>
                  <div className="mx-0.5 h-5 w-px bg-white/10" />
                  {/* 地图切换 */}
                  <select
                    value={activeMap.id}
                    onChange={(e) => {
                      select(e.target.value)
                      setSelectedTokenId(null)
                    }}
                    className="rounded-lg border border-white/10 bg-void-900/60 px-2 py-1 text-xs text-slate-200 outline-none focus:border-arcane-500 [&>option]:bg-void-900"
                  >
                    {maps.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs font-medium text-slate-300 hover:bg-white/10"
                    title="上传新地图"
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </button>

                  <button
                    onClick={() => updateMap(activeMap.id, { showGrid: !activeMap.showGrid })}
                    className={[
                      'flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors',
                      activeMap.showGrid ? 'bg-arcane-500/20 text-arcane-200' : 'text-slate-400 hover:bg-white/5',
                    ].join(' ')}
                    title={
                      activeMap.builtinGridDetected
                        ? `底图网格已识别 · ${activeMap.gridSize}px（叠加网格可手动开启）`
                        : '叠加网格开关'
                    }
                  >
                    <Grid3x3 className="h-3.5 w-3.5" />
                    {activeMap.builtinGridDetected ? (
                      <span className="text-[10px] text-emerald-300/90">底图✓</span>
                    ) : (
                      <span className="text-[10px] text-slate-500">未识别</span>
                    )}
                  </button>
                  <button
                    onClick={() => updateMap(activeMap.id, { showCoordinates: activeMap.showCoordinates === false })}
                    className={[
                      'flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors',
                      activeMap.showCoordinates !== false
                        ? 'bg-sky-500/20 text-sky-200'
                        : 'text-slate-400 hover:bg-white/5',
                    ].join(' ')}
                    title="显示/隐藏地图 X/Y 坐标轴"
                  >
                    <Grid3x3 className="h-3.5 w-3.5" />
                    XY
                  </button>
                  <button
                    onClick={() => void handleRedetectGrid()}
                    disabled={gridDetecting}
                    className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs font-medium text-slate-400 hover:bg-white/10 hover:text-slate-200 disabled:opacity-50"
                    title="重新分析当前地图底图是否自带网格"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${gridDetecting ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    onClick={() => {
                      setGridAdjustMode((v) => {
                        const next = !v
                        if (next) setMeasureMode(false)
                        return next
                      })
                    }}
                    className={[
                      'flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors',
                      gridAdjustMode
                        ? 'bg-amber-500/25 text-amber-200'
                        : 'text-slate-400 hover:bg-white/5',
                    ].join(' ')}
                    title="拖拽平移网格对齐底图；方向键微调（Shift=5px）"
                  >
                    <Move className="h-3.5 w-3.5" />
                    移动网格
                  </button>
                  <button
                    onClick={() =>
                      updateMap(activeMap.id, {
                        snapMonstersToGrid: activeMap.snapMonstersToGrid === false,
                      })
                    }
                    className={[
                      'flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors',
                      activeMap.snapMonstersToGrid !== false
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : 'text-slate-400 hover:bg-white/5',
                    ].join(' ')}
                    title="开启：敌人吸附格心、测距对齐格子；关闭：自由放置、测距任意两点"
                  >
                    <Magnet className="h-3.5 w-3.5" />
                    吸附
                  </button>
                  <div
                    className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1"
                    title="格宽=屏幕上每格像素（对齐底图）；1 格固定 5 尺"
                  >
                    <SlidersHorizontal className="h-3 w-3 text-slate-500" />
                    <span className="text-[10px] text-slate-500">格宽</span>
                    <input
                      type="range"
                      min={gridSizeBounds(activeMap).min}
                      max={gridSizeBounds(activeMap).max}
                      value={clampGridSize(activeMap.gridSize, activeMap)}
                      onPointerDown={() => setGridSizePreview(true)}
                      onPointerUp={() => setGridSizePreview(false)}
                      onPointerLeave={() => setGridSizePreview(false)}
                      onChange={(e) =>
                        updateMap(activeMap.id, {
                          gridSize: clampGridSize(Number(e.target.value), activeMap),
                        })
                      }
                      className="w-16 accent-arcane-500"
                    />
                    <input
                      type="number"
                      min={gridSizeBounds(activeMap).min}
                      max={gridSizeBounds(activeMap).max}
                      value={clampGridSize(activeMap.gridSize, activeMap)}
                      onFocus={() => setGridSizePreview(true)}
                      onBlur={() => setGridSizePreview(false)}
                      onChange={(e) =>
                        updateMap(activeMap.id, {
                          gridSize: clampGridSize(Number(e.target.value) || activeMap.gridSize, activeMap),
                        })
                      }
                      className="w-10 rounded border border-white/10 bg-void-900/60 px-1 py-0.5 text-center text-xs text-slate-200 outline-none focus:border-arcane-500"
                    />
                    <span className="text-[10px] text-slate-500">px·5尺/格</span>
                    <span className="mx-0.5 h-4 w-px bg-white/10" />
                    <input
                      type="color"
                      value={activeMap.gridColor ?? '#c4b5fd'}
                      onPointerDown={() => setGridSizePreview(true)}
                      onPointerUp={() => setGridSizePreview(false)}
                      onChange={(e) => {
                        setGridSizePreview(true)
                        updateMap(activeMap.id, { gridColor: e.target.value })
                      }}
                      className="h-6 w-6 cursor-pointer rounded border border-white/10 bg-transparent p-0"
                      title="叠加网格颜色"
                    />
                    <input
                      type="range"
                      min={0.08}
                      max={0.85}
                      step={0.02}
                      value={activeMap.gridOpacity ?? 0.28}
                      onChange={(e) =>
                        updateMap(activeMap.id, { gridOpacity: Number(e.target.value) })
                      }
                      onPointerDown={() => setGridSizePreview(true)}
                      onPointerUp={() => setGridSizePreview(false)}
                      className="w-10 accent-arcane-500"
                      title="网格透明度"
                    />
                  </div>
                  <button
                    onClick={() =>
                      setMeasureMode((v) => {
                        const next = !v
                        if (next) setGridAdjustMode(false)
                        return next
                      })
                    }
                    className={[
                      'flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors',
                      measureMode ? 'bg-ember-500/25 text-ember-400' : 'text-slate-400 hover:bg-white/5',
                    ].join(' ')}
                    title="测距：点 A 点 B；右键/Backspace 删除"
                  >
                    <Ruler className="h-3.5 w-3.5" />
                  </button>

                  <label className="flex items-center gap-1 rounded-lg bg-arcane-500/15 px-2 py-1 text-xs font-medium text-arcane-200">
                    <UserPlus className="h-3.5 w-3.5" />
                    <select
                      value=""
                      onChange={(e) => {
                        const ch = characters.find((c) => c.id === e.target.value)
                        if (ch) addCharacterToken(activeMap.id, { characterId: ch.id, name: ch.name, emoji: ch.avatar })
                        e.target.value = ''
                      }}
                      className="cursor-pointer bg-transparent text-xs text-arcane-200 outline-none [&>option]:bg-void-900 [&>option]:text-slate-200"
                    >
                      <option value="">角色…</option>
                      {characters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={() => addToken(activeMap.id, 'enemy')}
                    className="flex items-center gap-1 rounded-lg bg-rose-500/15 px-2 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/25"
                    title="放置空白敌人占位符"
                  >
                    <Skull className="h-3.5 w-3.5" />
                    敌人
                  </button>
                  <button
                    onClick={() => openEnemyPool('add')}
                    className="flex items-center gap-1 rounded-lg bg-rose-500/25 px-2 py-1 text-xs font-medium text-rose-200 hover:bg-rose-500/35"
                    title="从怪物池选择并添加"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    添加怪物
                  </button>
                  <button
                    onClick={() => addToken(activeMap.id, 'npc')}
                    className="flex items-center gap-1 rounded-lg bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/25"
                  >
                    <User className="h-3.5 w-3.5" />
                    NPC
                  </button>
                  <label className="flex items-center gap-1 rounded-lg bg-slate-500/15 px-2 py-1 text-xs font-medium text-slate-200">
                    <Square className="h-3.5 w-3.5" />
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) addObstacle(activeMap.id, e.target.value)
                        e.target.value = ''
                      }}
                      className="cursor-pointer bg-transparent text-xs text-slate-200 outline-none [&>option]:bg-void-900"
                    >
                      <option value="">障碍物…</option>
                      <option value="rock">石头</option>
                      <option value="chair">椅子</option>
                      <option value="pillar">石柱</option>
                      <option value="table">翻倒的桌子</option>
                    </select>
                  </label>
                  <button
                    onClick={() => {
                      if (confirm(`删除地图「${activeMap.name}」？`)) removeMap(activeMap.id)
                    }}
                    className="flex items-center rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-rose-500/15 hover:text-rose-300"
                    title="删除当前地图"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}

              <button
                onClick={() => setShowBar(false)}
                className="ml-auto flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-200"
                title="隐藏控制栏"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {combatActive && initiativeOrder.length > 0 && (
              <InitiativeTracker
                entries={initiativeOrder}
                activeIndex={initiativeIndex}
                scrollOffset={initiativeScroll}
                round={round}
                hpByToken={hpByToken}
                apByToken={apByToken}
                defeatedTokenIds={defeatedTokenIds}
                onScroll={setInitiativeScroll}
                onSelect={(tokenId) => handleSelectToken(tokenId)}
              />
            )}
            </div>
          ) : (
            <button
              onClick={() => setShowBar(true)}
              className="glass absolute right-2 top-2 z-30 flex h-9 items-center gap-1 rounded-xl px-3 text-xs font-medium text-slate-300 shadow-xl hover:text-arcane-200"
              title="显示控制栏"
            >
              <ChevronUp className="h-4 w-4 rotate-180" />
              控制栏
            </button>
          )}

          {/* token 编辑浮层（DM，选中棋子时） */}
          {/* DM token editing is handled inside EnemyDetailPanel. */}

          {selectedToken &&
            canShowEnemyDetail(selectedToken) &&
            (isDM || (selectedToken.showDetailOnToken !== false && enemyDetailOpen)) && (
            <EnemyDetailPanel
              token={selectedToken}
              closable={!isDM}
              isDM={isDM}
              mapId={activeMap.id}
              characters={characters}
              updateToken={updateToken}
              updateChar={updateChar}
              removeToken={removeToken}
              onClose={() => {
                setSelectedTokenId(null)
                setEnemyDetailOpen(false)
              }}
            />
          )}

          {selectedCharacterToken &&
            selectedCharacterToken.characterId &&
            (() => {
              const ch = characters.find((c) => c.id === selectedCharacterToken.characterId)
              return ch ? (
                <CharacterDetailPanel
                  token={selectedCharacterToken}
                  character={ch}
                  mapId={activeMap.id}
                  updateToken={updateToken}
                  updateChar={updateChar}
                  onClose={() => setSelectedCharacterTokenId(null)}
                />
              ) : null
            })()}

          {/* 左侧角色轨：圆形头像 + 物品/特性/法术/技能图标 */}
          {railChars.length > 0 && (
            <div className="absolute bottom-3 left-3 z-30 flex flex-col-reverse gap-3">
              {railChars.map((c) => (
                <CharacterRailEntry
                  key={c.id}
                  character={c}
                  isActive={c.id === activeCharId}
                  activePanel={c.id === activeCharId ? charPanel : null}
                  onAvatarClick={() => onAvatarClick(c.id)}
                  onPanelClick={(panel) => onPanelClick(c.id, panel)}
                />
              ))}
            </div>
          )}

          {/* 底部浮层：按图标打开物品/特性/法术/技能栏 */}
          {activeChar && charPanel && (
            <div
              className={[
                'absolute bottom-2 left-24 z-20 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-void-900/40 p-2 pr-4 pt-3 shadow-2xl backdrop-blur-sm',
                panelFull ? 'right-2' : '',
              ].join(' ')}
              style={
                panelFull
                  ? { top: '18%', bottom: 8, left: 96, right: 8 }
                  : { width: panelWidth, height: panelHeight }
              }
            >
              <div
                onMouseDown={startResizeHeight}
                className="absolute inset-x-0 top-0 z-10 flex h-3 cursor-ns-resize items-center justify-center rounded-t-2xl hover:bg-white/5"
                title="拖动上沿调整高度"
              >
                <GripHorizontal className="h-3 w-8 text-slate-500 opacity-70" />
              </div>

              <div className="mb-1.5 flex shrink-0 flex-wrap items-center gap-2">
                <span className={`flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br text-sm ${activeChar.accent}`}>
                  {activeChar.avatar}
                </span>
                <span className="text-sm font-semibold text-slate-100 drop-shadow">{activeChar.name}</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                  {charPanel === 'skills' && isHeavyGunner(activeChar.charClass)
                    ? '子弹消消乐'
                    : CHAR_PANEL_TITLES[charPanel]}
                </span>
                {canControlPlayerTurn && activeChar.id === turnCharacter?.id && (
                  <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-200">
                    行动点 {activeChar.currentAP}/{activeChar.actionPoints}
                  </span>
                )}
                {canControlPlayerTurn &&
                  activeChar.id === turnCharacter?.id &&
                  findClassTrait(activeChar, 'calmSpirit') && (
                    <div className="flex items-center gap-1 rounded-lg bg-teal-500/10 px-1.5 py-1">
                      <span className="px-1 text-[10px] font-semibold text-teal-200">
                        静心标记 {activeChar.combatBuffs?.calmSpiritStacks ?? 0}/4
                      </span>
                      <button
                        onClick={handleCalmSpiritMove}
                        disabled={(activeChar.combatBuffs?.calmSpiritStacks ?? 0) < 1}
                        className="rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-teal-100 hover:bg-white/15 disabled:cursor-not-allowed disabled:text-slate-600"
                        title="消耗 1 枚：免费移动，不失去静心"
                      >
                        移动
                      </button>
                      <button
                        onClick={handleCalmSpiritCrit}
                        disabled={(activeChar.combatBuffs?.calmSpiritStacks ?? 0) < 2}
                        className="rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-teal-100 hover:bg-white/15 disabled:cursor-not-allowed disabled:text-slate-600"
                        title="消耗 2 枚：下次攻击暴击率提升"
                      >
                        暴击
                      </button>
                      <button
                        onClick={handleCalmSpiritCooldown}
                        disabled={(activeChar.combatBuffs?.calmSpiritStacks ?? 0) < 3}
                        className="rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-teal-100 hover:bg-white/15 disabled:cursor-not-allowed disabled:text-slate-600"
                        title="消耗 3 枚：一个技能 CD -1"
                      >
                        CD
                      </button>
                      <button
                        onClick={handleCalmSpiritExtraTurn}
                        disabled={(activeChar.combatBuffs?.calmSpiritStacks ?? 0) < 4}
                        className="rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-teal-100 hover:bg-white/15 disabled:cursor-not-allowed disabled:text-slate-600"
                        title="消耗 4 枚：再次获得一个完整回合"
                      >
                        回合
                      </button>
                    </div>
                  )}
                <QiIndicator charClass={activeChar.charClass} level={activeChar.level} qi={activeChar.qi} compact />
                <button
                  onClick={handlePlayerEndTurn}
                  className="ml-auto flex items-center gap-1 rounded-lg bg-arcane-500/20 px-2 py-1 text-xs font-medium text-arcane-100 hover:bg-arcane-500/30"
                  title="结束回合：冷却 -1、行动点回满"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                  结束回合
                </button>
                <button
                  onClick={() => setPanelFull((v) => !v)}
                  className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10"
                  title={panelFull ? '还原宽度' : '铺满屏幕'}
                >
                  {panelFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                <button
                  onClick={closeCharDock}
                  className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10"
                  title="收起面板"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
                {charPanel === 'inventory' && <MapInventoryPanel charId={activeChar.id} />}
                {charPanel === 'features' && (
                  <FeaturesTab
                    charId={activeChar.id}
                    isDM={isDM}
                    battleMode={combatActive}
                    allowUpgrade={false}
                    isPlayerTurn={canControlPlayerTurn && activeChar.id === turnCharacter?.id}
                    onActivateFeature={handleActivateFeature}
                  />
                )}
                {charPanel === 'spells' && (
                  <MapSpellsPanel charId={activeChar.id} onUseSkill={handleUseSkill} />
                )}
                {charPanel === 'skills' &&
                  (isHeavyGunner(activeChar.charClass) ? (
                    <BulletMatchPanel
                      charId={activeChar.id}
                      canAct={
                        canControlPlayerTurn && activeChar.id === turnCharacter?.id
                      }
                    />
                  ) : (
                    <SkillBar
                      charId={activeChar.id}
                      hideTurnControls
                      scrollColumns
                      fillHeight
                      extraInfiniteActions={
                        canControlPlayerTurn && activeChar.id === turnCharacter?.id
                          ? ([
                              {
                                id: 'disengage',
                                name: '撤离',
                                icon: <Footprints className="h-4 w-4" />,
                                detail: '2 AP · 本回合移动不触发借机攻击',
                                disabled: activeChar.currentAP < 2,
                                used: disengagedCharIds.has(activeChar.id),
                                disabledLabel: '行动点不足',
                                usedLabel: '已撤离',
                                onUse: handleDisengage,
                              },
                            ] satisfies InfiniteAction[])
                          : []
                      }
                      onUseSkill={handleUseSkill}
                    />
                  ))}
              </div>

              {!panelFull && (
                <div
                  onMouseDown={startResizeWidth}
                  className="absolute inset-y-0 right-0 flex w-3 cursor-ew-resize items-center justify-center rounded-r-2xl hover:bg-white/5"
                  title="拖动右沿调整宽度"
                >
                  <GripVertical className="h-5 w-5 text-slate-500" />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isDM && (
        <EnemyPoolPicker
          open={enemyPoolOpen}
          title={enemyPoolMode === 'add' ? '添加怪物' : '更换怪物'}
          hint={
            enemyPoolMode === 'add'
              ? '选择一种怪物放置到地图中央'
              : selectedToken
                ? `为「${selectedToken.label}」选择新种类`
                : undefined
          }
          onClose={() => setEnemyPoolOpen(false)}
          onPick={handleEnemyPoolPick}
        />
      )}
    </div>
  )
}
