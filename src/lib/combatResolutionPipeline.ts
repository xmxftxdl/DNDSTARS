import type { BattleMap, Token } from '../store/maps'
import type { Character, CombatSkill } from '../types/character'
import type { ClassFeatureKey } from './traitRegistry'

export const COMBAT_RESOLUTION_STAGES = [
  'actionDeclared',
  'beforeAttackRoll',
  'attackRollResolved',
  'beforeDamageRoll',
  'damageRolled',
  'beforeDamageApplied',
  'damageApplied',
  'afterDamageApplied',
  'actionResolved',
] as const

export type CombatResolutionStage = (typeof COMBAT_RESOLUTION_STAGES)[number]

export const COMBAT_STAGE_LABELS: Record<CombatResolutionStage, string> = {
  actionDeclared: 'declare action',
  beforeAttackRoll: 'before attack roll',
  attackRollResolved: 'attack roll resolved',
  beforeDamageRoll: 'before damage roll',
  damageRolled: 'damage rolled',
  beforeDamageApplied: 'before damage applied',
  damageApplied: 'damage applied',
  afterDamageApplied: 'after damage applied',
  actionResolved: 'action resolved',
}

export interface CombatantRef {
  tokenId: string
  characterId?: string
}

export interface CombatRollSnapshot {
  values: number[]
  sides: number
  bonus?: number
  total: number
  label?: string
}

export interface CombatAttackRollSnapshot extends CombatRollSnapshot {
  ac?: number
  hit?: boolean
  crit?: boolean
}

export interface PendingDamagePacket {
  id: string
  source: CombatantRef
  target: CombatantRef
  amount: number
  damageType?: string
  roll?: CombatRollSnapshot
  prevented?: number
  tags?: string[]
}

export interface CombatResolutionContext {
  actionId: string
  round: number
  map: BattleMap
  characters: Character[]
  actor: CombatantRef
  primaryTarget?: CombatantRef
  skill?: CombatSkill
  stage: CombatResolutionStage
  attackRoll?: CombatAttackRollSnapshot
  damageRoll?: CombatRollSnapshot
  pendingDamage: PendingDamagePacket[]
  appliedDamage: PendingDamagePacket[]
  tags: Set<string>
  scratch: Record<string, unknown>
}

export type CombatMutation =
  | {
      type: 'spend-ap'
      characterId: string
      amount: number
      reason: string
    }
  | {
      type: 'spend-feature-use'
      characterId: string
      featureKey: ClassFeatureKey
      reason: string
    }
  | {
      type: 'damage'
      packet: PendingDamagePacket
    }
  | {
      type: 'heal'
      characterId: string
      amount: number
      reason: string
    }
  | {
      type: 'condition'
      target: CombatantRef
      condition: string
      mode: 'add' | 'remove'
      turns?: number
      reason: string
    }
  | {
      type: 'log'
      text: string
      kind?: 'system' | 'turn' | 'attack' | 'damage'
    }
  | {
      type: 'custom'
      key: string
      payload: unknown
    }

export interface CombatInterruptChoice {
  id: string
  label: string
  costAp?: number
  featureKey?: ClassFeatureKey
}

export interface CombatInterruptRequest {
  id: string
  actionId: string
  stage: CombatResolutionStage
  source: CombatantRef
  controllerCharacterId?: string
  title: string
  message: string
  choices: CombatInterruptChoice[]
  expiresAt?: number
}

export interface CombatInterruptResponse {
  requestId: string
  choiceId: string
  accepted: boolean
  clientId?: string
  updatedAt: number
}

export interface CombatResolutionApi {
  enqueueMutation(mutation: CombatMutation): void
  requestInterrupt(request: Omit<CombatInterruptRequest, 'id' | 'actionId' | 'stage'>): Promise<CombatInterruptResponse>
  hasRunOnce(key: string): boolean
  markRunOnce(key: string): void
}

export interface CombatResolutionHook {
  id: string
  stage: CombatResolutionStage
  priority?: number
  featureKey?: ClassFeatureKey
  onceKey?: (ctx: CombatResolutionContext) => string
  canRun: (ctx: CombatResolutionContext) => boolean
  run: (ctx: CombatResolutionContext, api: CombatResolutionApi) => void | Promise<void>
}

export interface CombatResolutionResult {
  actionId: string
  context: CombatResolutionContext
  mutations: CombatMutation[]
  interrupts: CombatInterruptRequest[]
}

export class CombatResolutionSession {
  readonly mutations: CombatMutation[] = []
  readonly interrupts: CombatInterruptRequest[] = []
  readonly onceKeys = new Set<string>()
  readonly context: CombatResolutionContext

  constructor(context: CombatResolutionContext) {
    this.context = context
  }

  result(): CombatResolutionResult {
    return {
      actionId: this.context.actionId,
      context: this.context,
      mutations: [...this.mutations],
      interrupts: [...this.interrupts],
    }
  }
}

export interface CombatResolutionBridge {
  requestInterrupt(request: CombatInterruptRequest): Promise<CombatInterruptResponse>
}

export interface CombatResolutionRunnerOptions {
  bridge?: CombatResolutionBridge
  onStageStart?: (ctx: CombatResolutionContext) => void | Promise<void>
  onStageEnd?: (ctx: CombatResolutionContext, mutations: CombatMutation[]) => void | Promise<void>
}

export function createCombatActionId(prefix = 'combat-action'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createNoopCombatBridge(): CombatResolutionBridge {
  return {
    async requestInterrupt(request) {
      return {
        requestId: request.id,
        choiceId: request.choices[0]?.id ?? 'decline',
        accepted: false,
        updatedAt: Date.now(),
      }
    },
  }
}

export function createCombatResolutionContext(input: {
  actionId?: string
  round: number
  map: BattleMap
  characters: Character[]
  actor: CombatantRef
  primaryTarget?: CombatantRef
  skill?: CombatSkill
  tags?: Iterable<string>
}): CombatResolutionContext {
  return {
    actionId: input.actionId ?? createCombatActionId(),
    round: input.round,
    map: input.map,
    characters: input.characters,
    actor: input.actor,
    primaryTarget: input.primaryTarget,
    skill: input.skill,
    stage: 'actionDeclared',
    pendingDamage: [],
    appliedDamage: [],
    tags: new Set(input.tags ?? []),
    scratch: {},
  }
}

export class CombatResolutionRunner {
  private hooks: CombatResolutionHook[] = []
  private queue: Promise<CombatResolutionResult | undefined> = Promise.resolve(undefined)
  private bridge: CombatResolutionBridge
  private onStageStart?: CombatResolutionRunnerOptions['onStageStart']
  private onStageEnd?: CombatResolutionRunnerOptions['onStageEnd']

  constructor(options: CombatResolutionRunnerOptions = {}) {
    this.bridge = options.bridge ?? createNoopCombatBridge()
    this.onStageStart = options.onStageStart
    this.onStageEnd = options.onStageEnd
  }

  register(hook: CombatResolutionHook): () => void {
    this.hooks = [...this.hooks, hook].sort(compareHooks)
    return () => {
      this.hooks = this.hooks.filter((item) => item.id !== hook.id)
    }
  }

  clearHooks(): void {
    this.hooks = []
  }

  enqueue(ctx: CombatResolutionContext): Promise<CombatResolutionResult> {
    const next = this.queue.then(() => this.run(ctx))
    this.queue = next.catch(() => undefined)
    return next
  }

  createSession(ctx: CombatResolutionContext): CombatResolutionSession {
    return new CombatResolutionSession(ctx)
  }

  async runStage(
    session: CombatResolutionSession,
    stage: CombatResolutionStage,
  ): Promise<CombatResolutionResult> {
    const ctx = session.context
    ctx.stage = stage

    const api: CombatResolutionApi = {
      enqueueMutation: (mutation) => session.mutations.push(mutation),
      requestInterrupt: async (request) => {
        const fullRequest: CombatInterruptRequest = {
          ...request,
          id: `${ctx.actionId}:${ctx.stage}:${session.interrupts.length + 1}`,
          actionId: ctx.actionId,
          stage: ctx.stage,
        }
        session.interrupts.push(fullRequest)
        return this.bridge.requestInterrupt(fullRequest)
      },
      hasRunOnce: (key) => session.onceKeys.has(key),
      markRunOnce: (key) => session.onceKeys.add(key),
    }

    await this.onStageStart?.(ctx)
    const stageHooks = this.hooks.filter((hook) => hook.stage === stage)
    for (const hook of stageHooks) {
      const onceKey = hook.onceKey?.(ctx)
      if (onceKey && session.onceKeys.has(onceKey)) continue
      if (!hook.canRun(ctx)) continue
      if (onceKey) session.onceKeys.add(onceKey)
      await hook.run(ctx, api)
    }
    await this.onStageEnd?.(ctx, session.mutations)

    return session.result()
  }

  private async run(ctx: CombatResolutionContext): Promise<CombatResolutionResult> {
    const session = this.createSession(ctx)
    for (const stage of COMBAT_RESOLUTION_STAGES) {
      await this.runStage(session, stage)
    }
    return session.result()
  }
}

function compareHooks(a: CombatResolutionHook, b: CombatResolutionHook): number {
  const priority = (b.priority ?? 0) - (a.priority ?? 0)
  if (priority !== 0) return priority
  return a.id.localeCompare(b.id)
}

export function findCharacterForRef(ctx: CombatResolutionContext, ref?: CombatantRef): Character | undefined {
  if (!ref?.characterId) return undefined
  return ctx.characters.find((character) => character.id === ref.characterId)
}

export function findTokenForRef(ctx: CombatResolutionContext, ref?: CombatantRef): Token | undefined {
  if (!ref?.tokenId) return undefined
  return ctx.map.tokens.find((token) => token.id === ref.tokenId)
}
