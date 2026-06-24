import { describe, expect, it } from 'vitest'
import type { Character } from '../types/character'
import {
  executeCombatMutationsAuthority,
  type CombatMutationAuthorityState,
  type CombatAuthorityState,
} from './combatAuthority'
import type { BattleMap } from '../store/maps'
import type { CombatMutation } from './combatResolutionPipeline'

function makeCharacter(patch: Partial<Character> = {}): Character {
  return {
    id: 'hero',
    name: 'Hero',
    player: '',
    avatar: '',
    accent: '',
    race: '',
    charClass: '',
    level: 1,
    background: '',
    experience: 0,
    reputation: 0,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    savingThrows: [],
    skills: [],
    maxHp: 20,
    currentHp: 20,
    tempHp: 0,
    hitDice: '1d8',
    ac: 14,
    speed: 30,
    initiativeBonus: 0,
    saveDC: 12,
    actionPoints: 2,
    currentAP: 0,
    passivePerception: 10,
    inspiration: 0,
    mana: 0,
    maxMana: 0,
    traits: [],
    combatSkills: [],
    conditions: [],
    notes: '',
    dmNotes: '',
    visibleToPlayers: true,
    ...patch,
  }
}

function makeState(character: Character = makeCharacter()): CombatAuthorityState {
  return {
    characters: [character],
    enemyApByToken: {
      goblin: { current: 0, max: 2 },
    },
  }
}

function makeMap(): BattleMap {
  return {
    id: 'map',
    name: 'Map',
    width: 500,
    height: 500,
    gridSize: 50,
    gridOffsetX: 0,
    gridOffsetY: 0,
    showGrid: true,
    tokens: [
      {
        id: 'hero-token',
        label: 'Hero',
        x: 50,
        y: 50,
        color: '#22c55e',
        emoji: '🙂',
        size: 1,
        type: 'player',
        characterId: 'hero',
        hp: 20,
        maxHp: 20,
      },
      {
        id: 'goblin',
        label: 'Goblin',
        x: 100,
        y: 50,
        color: '#ef4444',
        emoji: '😡',
        size: 1,
        type: 'enemy',
        hp: 12,
        maxHp: 12,
      },
    ],
  }
}

function makeMutationState(character: Character = makeCharacter()): CombatMutationAuthorityState {
  return {
    ...makeState(character),
    map: makeMap(),
  }
}

describe('combat authority', () => {
  it('executes combat mutations on the DM side in one authoritative pass', () => {
    const state = makeMutationState(
      makeCharacter({
        currentAP: 2,
        currentHp: 10,
        maxHp: 20,
        tempHp: 3,
        traits: [
          {
            id: 'trait-double-arrow',
            name: '双箭',
            level: 1,
            uses: 2,
            maxUses: 2,
            description: '',
            featureKey: 'doubleArrow',
          },
        ],
      }),
    )
    const mutations: CombatMutation[] = [
      { type: 'spend-ap', characterId: 'hero', amount: 1, reason: 'attack' },
      { type: 'spend-feature-use', characterId: 'hero', featureKey: 'doubleArrow', reason: 'used' },
      {
        type: 'damage',
        packet: {
          id: 'damage-1',
          source: { tokenId: 'goblin' },
          target: { tokenId: 'hero-token', characterId: 'hero' },
          amount: 5,
        },
      },
      { type: 'heal', characterId: 'hero', amount: 2, reason: 'test heal' },
      {
        type: 'condition',
        target: { tokenId: 'hero-token', characterId: 'hero' },
        condition: '眩晕',
        mode: 'add',
        turns: 1,
        reason: 'test stun',
      },
      { type: 'log', text: 'mutation log', kind: 'turn' },
      { type: 'custom', key: 'debug', payload: { ok: true } },
    ]

    const result = executeCombatMutationsAuthority(state, { role: 'dm', mutations })

    expect(result.failures).toEqual([])
    expect(result.logs).toHaveLength(1)
    expect(result.custom).toHaveLength(1)
    expect(result.state.characters[0]).toMatchObject({
      currentAP: 1,
      currentHp: 10,
      tempHp: 0,
      conditions: ['眩晕'],
    })
    expect(result.state.characters[0].traits[0].uses).toBe(1)
    expect(result.state.map.tokens.find((token) => token.id === 'hero-token')).toMatchObject({
      hp: 10,
      maxHp: 20,
      stunTurns: 1,
    })
    expect(state.characters[0]).toMatchObject({ currentAP: 2, currentHp: 10, tempHp: 3 })
    expect(state.map.tokens.find((token) => token.id === 'hero-token')).toMatchObject({ hp: 20 })
  })

  it('rejects combat mutations from the player side without changing state', () => {
    const state = makeMutationState(makeCharacter({ currentAP: 2 }))
    const result = executeCombatMutationsAuthority(state, {
      role: 'player',
      mutations: [{ type: 'spend-ap', characterId: 'hero', amount: 1, reason: 'player-side attempt' }],
    })

    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].reason).toBe('not-authority')
    expect(result.state).toBe(state)
    expect(state.characters[0].currentAP).toBe(2)
  })

  // [T-P1-420/AC3·AC5] 状态时长叠加=refresh-to-max（不再硬覆盖）。这是先前三处分歧里唯一 LIVE-reachable
  // 的覆盖路径（conditionTokenPatch via executeCombatMutationsAuthority），现已 reconcile。
  it('re-applying a 1-turn burn over a 3-turn burn yields 3 (refresh-to-max, not overwrite)', () => {
    const state = makeMutationState()
    // 先给 goblin 叠 3 回合燃烧
    state.map.tokens = state.map.tokens.map((t) => (t.id === 'goblin' ? { ...t, burningTurns: 3 } : t))
    const result = executeCombatMutationsAuthority(state, {
      role: 'dm',
      mutations: [
        {
          type: 'condition',
          target: { tokenId: 'goblin' },
          condition: '燃烧',
          mode: 'add',
          turns: 1,
          reason: 'reapply shorter burn',
        },
      ],
    })
    expect(result.failures).toEqual([])
    expect(result.state.map.tokens.find((t) => t.id === 'goblin')?.burningTurns).toBe(3)
  })

  it('remove-branch clears the status to undefined and refresh-to-max does not resurrect it', () => {
    const state = makeMutationState()
    state.map.tokens = state.map.tokens.map((t) => (t.id === 'goblin' ? { ...t, burningTurns: 3 } : t))
    const result = executeCombatMutationsAuthority(state, {
      role: 'dm',
      mutations: [
        {
          type: 'condition',
          target: { tokenId: 'goblin' },
          condition: '燃烧',
          mode: 'remove',
          reason: 'clear burn',
        },
      ],
    })
    expect(result.failures).toEqual([])
    expect(result.state.map.tokens.find((t) => t.id === 'goblin')?.burningTurns).toBeUndefined()
  })
})
