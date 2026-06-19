import { describe, expect, it } from 'vitest'
import type { Character } from '../types/character'
import {
  ARCHER_SKILL_TREE,
  buildSkillTierDescription,
  canUpgradeSkillRank,
  getArcherSkillDef,
  skillRankCapForCharacterLevel,
} from './archerSkillTree'

const DOC_SKILLS = {
  multiShot: [1, 'basic', undefined, undefined],
  whirlwindKick: [1, 'basic', undefined, undefined],
  clusterShot: [5, 'basic', 'multiShot', 1],
  burstKick: [5, 'basic', 'whirlwindKick', 1],
  rageShot: [8, 'hunt', undefined, undefined],
  riseKick: [8, 'basic', undefined, undefined],
  explosiveArrow: [12, 'magic', 'rageShot', 1],
  focusShot: [12, 'magic', 'clusterShot', 1],
  aerialCombo: [15, 'windrunner', 'clusterShot', 2],
  arrowStorm: [15, 'windrunner', 'clusterShot', 2],
  windKickCombo: [15, 'shadowdancer', 'whirlwindKick', 2],
  bindShot: [15, 'shadowdancer', 'burstKick', 2],
  refluxMagicArrow: [20, 'windrunner', 'focusShot', 1],
  encircle: [20, 'windrunner', 'arrowStorm', 1],
  spiralBlade: [20, 'shadowdancer', 'bindShot', 1],
  shadowDance: [20, 'shadowdancer', 'windKickCombo', 1],
  windTraceShot: [25, 'windrunner', 'encircle', 1],
  antiMagicArrow: [25, 'windrunner', 'refluxMagicArrow', 1],
  shadowStepShot: [25, 'shadowdancer', 'spiralBlade', 1],
  eagleStrike: [25, 'shadowdancer', 'shadowDance', 1],
} as const

function character(level: number, skillRanks: Record<string, number>): Character {
  return {
    id: 'archer-test',
    name: 'Archer Test',
    player: '',
    avatar: '',
    accent: '',
    race: '',
    charClass: '逐风者',
    level,
    background: '',
    experience: 0,
    reputation: 0,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    savingThrows: [],
    skills: [],
    maxHp: 10,
    currentHp: 10,
    tempHp: 0,
    hitDice: '1d8',
    ac: 10,
    speed: 30,
    initiativeBonus: 0,
    saveDC: 12,
    actionPoints: 2,
    currentAP: 2,
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
    skillRanks,
  }
}

describe('archer document skill tree config', () => {
  it('matches the document skill unlock levels, directions, and prerequisites', () => {
    expect(new Set(ARCHER_SKILL_TREE.map((s) => s.id))).toEqual(new Set(Object.keys(DOC_SKILLS)))

    for (const [id, [unlockLevel, direction, prereqId, prereqRank]] of Object.entries(DOC_SKILLS)) {
      const def = getArcherSkillDef(id)
      expect(def, id).toBeTruthy()
      expect(def!.unlockLevel, id).toBe(unlockLevel)
      expect(def!.direction, id).toBe(direction)
      expect(def!.prerequisite?.skillId, id).toBe(prereqId)
      expect(def!.prerequisite?.minRank, id).toBe(prereqRank)
    }
  })

  it('uses the document skill-rank unlock table', () => {
    expect([1, 4, 5, 9, 10, 14, 15, 19, 20].map((level) => skillRankCapForCharacterLevel(level, 1))).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4, 5,
    ])
    expect([12, 19, 20, 24, 25, 29, 30, 34, 35].map((level) => skillRankCapForCharacterLevel(level, 12))).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4, 5,
    ])
    expect([25, 29, 30, 34, 35, 39, 40, 44, 45].map((level) => skillRankCapForCharacterLevel(level, 25))).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4, 5,
    ])
  })

  it('blocks upgrades above the document rank cap', () => {
    expect(canUpgradeSkillRank(character(19, { focusShot: 1, clusterShot: 1 }), 'focusShot')).toBe(false)
    expect(canUpgradeSkillRank(character(20, { focusShot: 1, clusterShot: 1 }), 'focusShot')).toBe(true)
  })

  it('formats burst kick stun only from rank 3', () => {
    const def = getArcherSkillDef('burstKick')!

    expect(buildSkillTierDescription(def, 1)).toContain('范围：5 尺')
    expect(buildSkillTierDescription(def, 1)).toContain('目标：单体')
    expect(buildSkillTierDescription(def, 1)).toContain('伤害：2D4 点钝击伤害')
    expect(buildSkillTierDescription(def, 1)).not.toContain('眩晕')
    expect(buildSkillTierDescription(def, 1)).not.toContain('体质豁免')

    expect(buildSkillTierDescription(def, 2)).toContain('伤害：3D4 点钝击伤害')
    expect(buildSkillTierDescription(def, 2)).not.toContain('眩晕')

    expect(buildSkillTierDescription(def, 3)).toContain('豁免：体质豁免')
    expect(buildSkillTierDescription(def, 3)).toContain('效果：失败眩晕 1 回合')
  })

  it('formats wind kick combo in the audit-friendly skill layout', () => {
    const def = getArcherSkillDef('windKickCombo')!
    const text = buildSkillTierDescription(def, 1)

    expect(text).toContain('范围：移动 15 尺，终点 5 尺内')
    expect(text).toContain('目标：单体')
    expect(text).toContain('伤害：3D4 点钝击伤害')
    expect(text).toContain('目标处于击飞状态时额外造成 1D6 点钝击伤害')
    expect(def.tiers.every((tier) => (tier.damageBonus ?? 0) === 0)).toBe(true)
  })
})
