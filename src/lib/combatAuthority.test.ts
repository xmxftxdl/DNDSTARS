import { describe, expect, it } from 'vitest'
import type { Character } from '../types/character'
import {
  activateFeatureAuthority,
  attackCharacterAuthority,
  moveCharacterAuthority,
  resolveDodgeAuthority,
  spendEnemyApAuthority,
  startCombatAuthority,
  type CombatAuthorityState,
} from './combatAuthority'

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

describe('combat authority', () => {
  it('starts combat from the DM side and initializes character and enemy AP', () => {
    const result = startCombatAuthority(makeState(), { role: 'dm', enemyTokenIds: ['goblin'] })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.characters[0].currentAP).toBe(2)
    expect(result.state.enemyApByToken.goblin).toEqual({ current: 2, max: 2 })
  })

  it('does not allow the player side to initialize combat AP', () => {
    const state = makeState()
    const result = startCombatAuthority(state, { role: 'player', enemyTokenIds: ['goblin'] })

    expect(result.ok).toBe(false)
    expect(result.state).toBe(state)
    expect(result.state.characters[0].currentAP).toBe(0)
  })

  it('spends 1 AP when the DM activates a feature', () => {
    const result = activateFeatureAuthority(makeState(makeCharacter({ currentAP: 2 })), {
      role: 'dm',
      characterId: 'hero',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({ before: 2, after: 1, amount: 1 })
    expect(result.state.characters[0].currentAP).toBe(1)
  })

  it('spends 1 AP when the DM accepts a character move', () => {
    const result = moveCharacterAuthority(makeState(makeCharacter({ currentAP: 2 })), {
      role: 'dm',
      characterId: 'hero',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.characters[0].currentAP).toBe(1)
  })

  it('spends 1 AP when the DM accepts a character attack', () => {
    const result = attackCharacterAuthority(makeState(makeCharacter({ currentAP: 2 })), {
      role: 'dm',
      characterId: 'hero',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.characters[0].currentAP).toBe(1)
  })

  it('spends enemy AP on the DM side for monster attacks', () => {
    const result = spendEnemyApAuthority(makeState(), {
      role: 'dm',
      tokenId: 'goblin',
      amount: 1,
    })

    expect(result.ok).toBe(false)

    const ready = makeState()
    ready.enemyApByToken.goblin.current = 2
    const spent = spendEnemyApAuthority(ready, {
      role: 'dm',
      tokenId: 'goblin',
      amount: 1,
    })

    expect(spent.ok).toBe(true)
    if (!spent.ok) return
    expect(spent.state.enemyApByToken.goblin.current).toBe(1)
  })

  it('resolves a successful dodge without damage while spending dodge AP', () => {
    const result = resolveDodgeAuthority(makeState(makeCharacter({ currentAP: 2, ac: 14 })), {
      role: 'dm',
      targetCharacterId: 'hero',
      wantsDodge: true,
      d20: 8,
      attackBonus: 5,
      damage: 10,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      dodgeApSpent: true,
      dodged: true,
      attackTotal: 13,
      damageApplied: 0,
    })
    expect(result.state.characters[0]).toMatchObject({ currentAP: 1, currentHp: 20 })
  })

  it('resolves a failed dodge by applying damage on the DM side', () => {
    const result = resolveDodgeAuthority(makeState(makeCharacter({ currentAP: 2, ac: 14 })), {
      role: 'dm',
      targetCharacterId: 'hero',
      wantsDodge: true,
      d20: 9,
      attackBonus: 5,
      damage: 10,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      dodgeApSpent: true,
      dodged: false,
      attackTotal: 14,
      damageApplied: 10,
    })
    expect(result.state.characters[0]).toMatchObject({ currentAP: 1, currentHp: 10 })
  })

  it('keeps player-side dodge answers from mutating authoritative HP or AP', () => {
    const state = makeState(makeCharacter({ currentAP: 2, currentHp: 20 }))
    const result = resolveDodgeAuthority(state, {
      role: 'player',
      targetCharacterId: 'hero',
      wantsDodge: true,
      d20: 20,
      attackBonus: 5,
      damage: 10,
    })

    expect(result.ok).toBe(false)
    expect(result.state).toBe(state)
    expect(state.characters[0]).toMatchObject({ currentAP: 2, currentHp: 20 })
  })
})
