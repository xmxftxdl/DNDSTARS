import type { BattleMap, Token } from '../store/maps'
import type { Character } from '../types/character'
import type { CombatMutation, PendingDamagePacket } from './combatResolutionPipeline'
import { statusRefreshTokenPatch } from './combatTokens'

export type CombatAuthorityRole = 'dm' | 'player'

export interface EnemyApState {
  current: number
  max: number
}

export interface CombatAuthorityState {
  characters: Character[]
  enemyApByToken: Record<string, EnemyApState>
}

export interface CombatMutationAuthorityState extends CombatAuthorityState {
  map: BattleMap
}

export interface AuthorityFailure {
  ok: false
  state: CombatAuthorityState
  reason: 'not-authority' | 'not-found' | 'dead' | 'invalid-amount' | 'insufficient-ap'
}

export interface CombatMutationExecutionFailure {
  mutation: CombatMutation
  reason: AuthorityFailure['reason'] | 'unsupported'
}

export interface CombatMutationExecutionResult {
  state: CombatMutationAuthorityState
  logs: Extract<CombatMutation, { type: 'log' }>[]
  custom: Extract<CombatMutation, { type: 'custom' }>[]
  failures: CombatMutationExecutionFailure[]
}

function cloneState(state: CombatAuthorityState): CombatAuthorityState {
  return {
    characters: state.characters.map((character) => ({
      ...character,
      combatBuffs: character.combatBuffs ? { ...character.combatBuffs } : undefined,
      traits: character.traits.map((trait) => ({ ...trait })),
      combatSkills: character.combatSkills.map((skill) => ({ ...skill })),
      conditions: [...character.conditions],
    })),
    enemyApByToken: Object.fromEntries(
      Object.entries(state.enemyApByToken).map(([id, ap]) => [id, { ...ap }]),
    ),
  }
}

function cloneMap(map: BattleMap): BattleMap {
  return {
    ...map,
    tokens: map.tokens.map((token) => ({ ...token })),
  }
}

function cloneMutationState(state: CombatMutationAuthorityState): CombatMutationAuthorityState {
  return {
    ...cloneState(state),
    map: cloneMap(state.map),
  }
}

function fail(
  state: CombatAuthorityState,
  reason: AuthorityFailure['reason'],
): AuthorityFailure {
  return { ok: false, state, reason }
}

function assertDm(
  state: CombatAuthorityState,
  role: CombatAuthorityRole,
): AuthorityFailure | null {
  return role === 'dm' ? null : fail(state, 'not-authority')
}

function updateCharacterInMutationState(
  state: CombatMutationAuthorityState,
  characterId: string,
  updater: (character: Character) => Character,
): CombatMutationAuthorityState {
  const nextCharacter = state.characters.find((character) => character.id === characterId)
  if (!nextCharacter) return state
  const updatedCharacter = updater(nextCharacter)
  return {
    ...state,
    characters: state.characters.map((character) =>
      character.id === characterId ? updatedCharacter : character,
    ),
    map: syncCharacterTokenHp(state.map, updatedCharacter),
  }
}

function updateTokenInMap(map: BattleMap, tokenId: string, updater: (token: Token) => Token): BattleMap {
  return {
    ...map,
    tokens: map.tokens.map((token) => (token.id === tokenId ? updater(token) : token)),
  }
}

function syncCharacterTokenHp(map: BattleMap, character: Character): BattleMap {
  return {
    ...map,
    tokens: map.tokens.map((token) =>
      token.characterId === character.id
        ? {
            ...token,
            hp: character.currentHp,
            maxHp: character.maxHp,
          }
        : token,
    ),
  }
}

function conditionTokenPatch(condition: string, turns?: number): Partial<Token> {
  const value = turns && turns > 0 ? turns : undefined
  switch (condition) {
    case '燃烧':
      return { burningTurns: value }
    case '点燃':
      return { igniteTurns: value }
    case '中毒':
      return { poisonTurns: value }
    case '眩晕':
      return { stunTurns: value }
    case '束缚':
      return { restrainedTurns: value }
    case '脆弱':
      return { vulnerableTurns: value }
    case '无法移动':
      return { noMoveTurns: value }
    default:
      return {}
  }
}

function findMutationTargetCharacter(
  state: CombatMutationAuthorityState,
  target: PendingDamagePacket['target'],
): Character | undefined {
  if (target.characterId) return state.characters.find((character) => character.id === target.characterId)
  const token = state.map.tokens.find((item) => item.id === target.tokenId)
  return token?.characterId ? state.characters.find((character) => character.id === token.characterId) : undefined
}

function applyCharacterDamage(character: Character, amount: number): Character {
  const beforeTemp = character.tempHp ?? 0
  const nextTemp = Math.max(0, beforeTemp - amount)
  const remainingDamage = Math.max(0, amount - beforeTemp)
  return {
    ...character,
    tempHp: nextTemp,
    currentHp: Math.max(0, character.currentHp - remainingDamage),
  }
}

function applyCharacterHeal(character: Character, amount: number): Character {
  return {
    ...character,
    currentHp: Math.min(character.maxHp, character.currentHp + amount),
  }
}

function applyTokenDamage(token: Token, amount: number): Token {
  if (typeof token.hp !== 'number') return token
  return {
    ...token,
    hp: Math.max(0, token.hp - amount),
  }
}

export function executeCombatMutationsAuthority(
  state: CombatMutationAuthorityState,
  params: { role: CombatAuthorityRole; mutations: CombatMutation[] },
): CombatMutationExecutionResult {
  const denied = assertDm(state, params.role)
  if (denied) {
    return {
      state,
      logs: [],
      custom: [],
      failures: params.mutations.map((mutation) => ({ mutation, reason: denied.reason })),
    }
  }

  let next = cloneMutationState(state)
  const logs: CombatMutationExecutionResult['logs'] = []
  const custom: CombatMutationExecutionResult['custom'] = []
  const failures: CombatMutationExecutionFailure[] = []

  for (const mutation of params.mutations) {
    switch (mutation.type) {
      case 'spend-ap': {
        const character = next.characters.find((item) => item.id === mutation.characterId)
        if (!character) {
          failures.push({ mutation, reason: 'not-found' })
          break
        }
        if (character.currentHp <= 0) {
          failures.push({ mutation, reason: 'dead' })
          break
        }
        if (!Number.isFinite(mutation.amount) || mutation.amount <= 0) {
          failures.push({ mutation, reason: 'invalid-amount' })
          break
        }
        if (character.currentAP < mutation.amount) {
          failures.push({ mutation, reason: 'insufficient-ap' })
          break
        }
        next = updateCharacterInMutationState(next, character.id, (item) => ({
          ...item,
          currentAP: item.currentAP - mutation.amount,
        }))
        break
      }
      case 'spend-qi': {
        const character = next.characters.find((item) => item.id === mutation.characterId)
        if (!character) {
          failures.push({ mutation, reason: 'not-found' })
          break
        }
        if (character.currentHp <= 0) {
          failures.push({ mutation, reason: 'dead' })
          break
        }
        if (!Number.isFinite(mutation.amount) || mutation.amount <= 0) {
          failures.push({ mutation, reason: 'invalid-amount' })
          break
        }
        if ((character.qi ?? 0) < mutation.amount) {
          failures.push({ mutation, reason: 'insufficient-ap' })
          break
        }
        next = updateCharacterInMutationState(next, character.id, (item) => ({
          ...item,
          qi: Math.max(0, (item.qi ?? 0) - mutation.amount),
        }))
        break
      }
      case 'spend-feature-use': {
        const character = next.characters.find((item) => item.id === mutation.characterId)
        if (!character) {
          failures.push({ mutation, reason: 'not-found' })
          break
        }
        const trait = character.traits.find((item) => item.featureKey === mutation.featureKey)
        if (!trait) {
          failures.push({ mutation, reason: 'not-found' })
          break
        }
        if (trait.maxUses > 0 && trait.uses <= 0) {
          failures.push({ mutation, reason: 'insufficient-ap' })
          break
        }
        next = updateCharacterInMutationState(next, character.id, (item) => ({
          ...item,
          traits: item.traits.map((entry) =>
            entry.id === trait.id && entry.maxUses > 0
              ? { ...entry, uses: Math.max(0, entry.uses - 1) }
              : entry,
          ),
        }))
        break
      }
      case 'damage': {
        if (!Number.isFinite(mutation.packet.amount) || mutation.packet.amount < 0) {
          failures.push({ mutation, reason: 'invalid-amount' })
          break
        }
        const character = findMutationTargetCharacter(next, mutation.packet.target)
        if (character) {
          next = updateCharacterInMutationState(next, character.id, (item) =>
            applyCharacterDamage(item, mutation.packet.amount),
          )
          break
        }
        const token = next.map.tokens.find((item) => item.id === mutation.packet.target.tokenId)
        if (!token) {
          failures.push({ mutation, reason: 'not-found' })
          break
        }
        next = {
          ...next,
          map: updateTokenInMap(next.map, token.id, (item) => applyTokenDamage(item, mutation.packet.amount)),
        }
        break
      }
      case 'heal': {
        if (!Number.isFinite(mutation.amount) || mutation.amount < 0) {
          failures.push({ mutation, reason: 'invalid-amount' })
          break
        }
        const character = next.characters.find((item) => item.id === mutation.characterId)
        if (!character) {
          failures.push({ mutation, reason: 'not-found' })
          break
        }
        next = updateCharacterInMutationState(next, character.id, (item) =>
          applyCharacterHeal(item, mutation.amount),
        )
        break
      }
      case 'condition': {
        const character = findMutationTargetCharacter(next, mutation.target)
        if (character) {
          next = updateCharacterInMutationState(next, character.id, (item) => {
            const conditions =
              mutation.mode === 'add'
                ? Array.from(new Set([...item.conditions, mutation.condition]))
                : item.conditions.filter((condition) => condition !== mutation.condition)
            return { ...item, conditions }
          })
        }
        const token = next.map.tokens.find((item) => item.id === mutation.target.tokenId)
        if (token) {
          // [T-P1-420/AC3] add 分支走唯一的 refresh-to-max 规则（再次施加取较大剩余回合，不再硬覆盖，
          // 与 MapsPage 内联 Math.max 同义）；remove 分支硬清为 undefined（0 stays 0，不复活已清状态）。
          const patch =
            mutation.mode === 'add'
              ? statusRefreshTokenPatch(token, mutation.condition, mutation.turns)
              : conditionTokenPatch(mutation.condition, 0)
          if (Object.keys(patch).length > 0) {
            next = {
              ...next,
              map: updateTokenInMap(next.map, token.id, (item) => ({ ...item, ...patch })),
            }
          }
        }
        if (!character && !token) failures.push({ mutation, reason: 'not-found' })
        break
      }
      case 'log':
        logs.push(mutation)
        break
      case 'custom':
        custom.push(mutation)
        break
      default:
        failures.push({ mutation, reason: 'unsupported' })
        break
    }
  }

  return { state: next, logs, custom, failures }
}
