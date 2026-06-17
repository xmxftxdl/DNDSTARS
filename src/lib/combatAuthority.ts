import type { Character } from '../types/character'

export type CombatAuthorityRole = 'dm' | 'player'

export interface EnemyApState {
  current: number
  max: number
}

export interface CombatAuthorityState {
  characters: Character[]
  enemyApByToken: Record<string, EnemyApState>
}

export interface AuthorityFailure {
  ok: false
  state: CombatAuthorityState
  reason: 'not-authority' | 'not-found' | 'dead' | 'invalid-amount' | 'insufficient-ap'
}

export interface AuthoritySuccess<T = undefined> {
  ok: true
  state: CombatAuthorityState
  value: T
}

export type AuthorityResult<T = undefined> = AuthoritySuccess<T> | AuthorityFailure

export interface SpendApValue {
  before: number
  after: number
  amount: number
}

export interface DodgeResolutionValue {
  wantsDodge: boolean
  dodgeApSpent: boolean
  dodged: boolean
  attackTotal?: number
  targetAc: number
  damageApplied: number
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

function fail<T>(
  state: CombatAuthorityState,
  reason: AuthorityFailure['reason'],
): AuthorityResult<T> {
  return { ok: false, state, reason }
}

function assertDm<T>(
  state: CombatAuthorityState,
  role: CombatAuthorityRole,
): AuthorityFailure | null {
  return role === 'dm' ? null : fail<T>(state, 'not-authority')
}

function updateCharacter(
  state: CombatAuthorityState,
  characterId: string,
  updater: (character: Character) => Character,
): CombatAuthorityState {
  return {
    ...state,
    characters: state.characters.map((character) =>
      character.id === characterId ? updater(character) : character,
    ),
  }
}

export function startCombatAuthority(
  state: CombatAuthorityState,
  params: { role: CombatAuthorityRole; enemyTokenIds?: string[] },
): AuthorityResult {
  const denied = assertDm(state, params.role)
  if (denied) return denied

  const next = cloneState(state)
  next.characters = next.characters.map((character) => ({
    ...character,
    currentAP: character.actionPoints,
  }))
  for (const tokenId of params.enemyTokenIds ?? Object.keys(next.enemyApByToken)) {
    next.enemyApByToken[tokenId] = { current: 2, max: 2 }
  }
  return { ok: true, state: next, value: undefined }
}

export function spendCharacterApAuthority(
  state: CombatAuthorityState,
  params: { role: CombatAuthorityRole; characterId: string; amount: number },
): AuthorityResult<SpendApValue> {
  const denied = assertDm<SpendApValue>(state, params.role)
  if (denied) return denied
  if (!Number.isFinite(params.amount) || params.amount <= 0) return fail(state, 'invalid-amount')

  const character = state.characters.find((item) => item.id === params.characterId)
  if (!character) return fail(state, 'not-found')
  if (character.currentHp <= 0) return fail(state, 'dead')
  if (character.currentAP < params.amount) return fail(state, 'insufficient-ap')

  const after = character.currentAP - params.amount
  return {
    ok: true,
    state: updateCharacter(cloneState(state), character.id, (item) => ({
      ...item,
      currentAP: after,
    })),
    value: { before: character.currentAP, after, amount: params.amount },
  }
}

export function spendEnemyApAuthority(
  state: CombatAuthorityState,
  params: { role: CombatAuthorityRole; tokenId: string; amount: number },
): AuthorityResult<SpendApValue> {
  const denied = assertDm<SpendApValue>(state, params.role)
  if (denied) return denied
  if (!Number.isFinite(params.amount) || params.amount <= 0) return fail(state, 'invalid-amount')

  const enemyAp = state.enemyApByToken[params.tokenId]
  if (!enemyAp) return fail(state, 'not-found')
  if (enemyAp.current < params.amount) return fail(state, 'insufficient-ap')

  const next = cloneState(state)
  const after = enemyAp.current - params.amount
  next.enemyApByToken[params.tokenId] = { ...enemyAp, current: after }
  return {
    ok: true,
    state: next,
    value: { before: enemyAp.current, after, amount: params.amount },
  }
}

export function activateFeatureAuthority(
  state: CombatAuthorityState,
  params: { role: CombatAuthorityRole; characterId: string },
): AuthorityResult<SpendApValue> {
  return spendCharacterApAuthority(state, { ...params, amount: 1 })
}

export function moveCharacterAuthority(
  state: CombatAuthorityState,
  params: { role: CombatAuthorityRole; characterId: string },
): AuthorityResult<SpendApValue> {
  return spendCharacterApAuthority(state, { ...params, amount: 1 })
}

export function attackCharacterAuthority(
  state: CombatAuthorityState,
  params: { role: CombatAuthorityRole; characterId: string },
): AuthorityResult<SpendApValue> {
  return spendCharacterApAuthority(state, { ...params, amount: 1 })
}

export function applyDamageAuthority(
  state: CombatAuthorityState,
  params: { role: CombatAuthorityRole; characterId: string; amount: number },
): AuthorityResult<{ hpBefore: number; tempBefore: number; hpAfter: number; tempAfter: number }> {
  const denied = assertDm<{ hpBefore: number; tempBefore: number; hpAfter: number; tempAfter: number }>(
    state,
    params.role,
  )
  if (denied) return denied
  if (!Number.isFinite(params.amount) || params.amount < 0) return fail(state, 'invalid-amount')

  const character = state.characters.find((item) => item.id === params.characterId)
  if (!character) return fail(state, 'not-found')

  const hpBefore = character.currentHp
  const tempBefore = character.tempHp ?? 0
  const tempAfter = Math.max(0, tempBefore - params.amount)
  const remainingDamage = Math.max(0, params.amount - tempBefore)
  const hpAfter = Math.max(0, hpBefore - remainingDamage)
  return {
    ok: true,
    state: updateCharacter(cloneState(state), character.id, (item) => ({
      ...item,
      currentHp: hpAfter,
      tempHp: tempAfter,
    })),
    value: { hpBefore, tempBefore, hpAfter, tempAfter },
  }
}

export function resolveDodgeAuthority(
  state: CombatAuthorityState,
  params: {
    role: CombatAuthorityRole
    targetCharacterId: string
    wantsDodge: boolean
    d20?: number
    attackBonus: number
    damage: number
  },
): AuthorityResult<DodgeResolutionValue> {
  const denied = assertDm<DodgeResolutionValue>(state, params.role)
  if (denied) return denied

  const target = state.characters.find((item) => item.id === params.targetCharacterId)
  if (!target) return fail(state, 'not-found')
  if (target.currentHp <= 0) return fail(state, 'dead')

  let next = cloneState(state)
  let dodgeApSpent = false
  let attackTotal: number | undefined
  let dodged = false

  if (params.wantsDodge) {
    const spent = spendCharacterApAuthority(next, {
      role: 'dm',
      characterId: target.id,
      amount: 1,
    })
    if (!spent.ok) return spent
    next = spent.state
    dodgeApSpent = true
    attackTotal = (params.d20 ?? 0) + params.attackBonus
    dodged = attackTotal < target.ac
  }

  if (dodged) {
    return {
      ok: true,
      state: next,
      value: {
        wantsDodge: params.wantsDodge,
        dodgeApSpent,
        dodged,
        attackTotal,
        targetAc: target.ac,
        damageApplied: 0,
      },
    }
  }

  const damaged = applyDamageAuthority(next, {
    role: 'dm',
    characterId: target.id,
    amount: params.damage,
  })
  if (!damaged.ok) return damaged
  return {
    ok: true,
    state: damaged.state,
    value: {
      wantsDodge: params.wantsDodge,
      dodgeApSpent,
      dodged,
      attackTotal,
      targetAc: target.ac,
      damageApplied: params.damage,
    },
  }
}
