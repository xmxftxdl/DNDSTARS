import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { loadSharedResource, publishSharedEvent, saveSharedResource, subscribeSharedEvent } from '../lib/sharedApi'
import { isPlayerPort, modeFromPort } from '../lib/appMode'
import {
  canLearnSkill,
  canUpgradeSkillRank,
  getSkillRank,
} from '../lib/archerSkillTree'
import {
  applyTraitFeatureRank,
  availableFeatureUpgradePoints,
  createClassTrait,
  featureUpgradePointsEarned,
  findClassTrait,
  MAX_FEATURE_LEVEL,
  syncArcherTraits,
} from '../lib/classFeatures'
import {
  migrateCharacterTraits,
  maxQiForLevel,
  resetCombatTraitUses,
  syncQiForCharacter,
  TRAIT_CHOICE_GROUPS,
  type ClassFeatureKey,
  type MetaChoiceKey,
  type TraitChoiceOption,
} from '../lib/traitRegistry'
import { beginCalmMindTurn, calmBreathState, initCalmMindForCombat, isCalmMindActive, triggerOutOfBreath, tickOutOfBreathOnEndTurn } from '../lib/calmMind'
import { syncArcherCombatSkills } from '../lib/skillTreeSync'
import { ensureDefaultEquipment, isMagicDamageSkill, refreshKnownEquipment, syncCombatDerivedStats } from '../lib/combatStats'

function skillCooldownRemaining(skill: { cooldown: number; cdReduction: number }): number {
  if (skill.cooldown <= 0) return 0
  return Math.max(1, skill.cooldown - skill.cdReduction)
}
import type { Character, CombatSkill, Trait } from '../types/character'

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

let lastSharedCharactersSnapshot = ''
let lastLocalCharactersWriteAt = 0
// [T11/AC6 · E6] 玩家端「已应用的最新 updatedAt」单调水位，丢弃乱序/陈旧的共享快照。
// 与 DM 用的 lastLocalCharactersWriteAt 语义不同，故单列一个，避免相互污染。
let lastAppliedCharactersUpdatedAt = 0
let characterSaveSeq = 0

/**
 * [T10/AC2 · E11] 删除墓碑：id ⇒ 删除时间戳。
 * 没有墓碑时，一次本地删除若落在 `setTimeout(saveCharacters,0)` 窗口内、或对端尚未看到该删除，
 * 对端一份仍含该角色的「全量数组」快照就会在 loadShared 里把它复活。墓碑在有界窗口内抑制复活：
 * loadShared 应用共享快照时过滤掉仍被墓碑标记的 id。
 * 窗口需 ≥ 轮询周期（characters 轮询 ~500ms，见 MapsPage）以覆盖一来回，并在过期后 GC，
 * 这样被删 id 之后可被复用（例如重新创建同名角色拿到回收 id 时不会被旧墓碑误杀）。
 */
const CHARACTER_TOMBSTONE_TTL_MS = 10000
const characterTombstones = new Map<string, number>()

/** 记录一条删除墓碑（id + 当前时间）。删除路径必须在写出快照前调用。 */
export function recordCharacterTombstone(id: string, now: number = Date.now()): void {
  characterTombstones.set(id, now)
}

/** 清掉超过 TTL 的墓碑，使被删 id 可被复用；返回存活墓碑数（便于测试）。 */
export function gcCharacterTombstones(now: number = Date.now()): number {
  for (const [id, ts] of characterTombstones) {
    if (now - ts > CHARACTER_TOMBSTONE_TTL_MS) characterTombstones.delete(id)
  }
  return characterTombstones.size
}

/** 该 id 当前是否仍被墓碑标记（自动顺带 GC 过期项）。 */
export function isCharacterTombstoned(id: string, now: number = Date.now()): boolean {
  gcCharacterTombstones(now)
  return characterTombstones.has(id)
}

/** 测试钩子：清空全部墓碑。 */
export function clearCharacterTombstonesForTest(): void {
  characterTombstones.clear()
}

/**
 * [T10/AC2] 从一份待应用的共享角色数组里剔除仍被墓碑标记的角色，阻止复活。
 * 纯函数，便于 T13 在不挂载组件、不碰 localStorage 的前提下单测。
 */
export function filterTombstonedCharacters(
  characters: Character[],
  now: number = Date.now(),
): Character[] {
  gcCharacterTombstones(now)
  if (characterTombstones.size === 0) return characters
  return characters.filter((c) => !characterTombstones.has(c.id))
}
let traitChoiceSyncStarted = false
let stopTraitChoiceSync: (() => void) | null = null
const seenTraitChoiceEventIds = new Set<string>()
const pendingLocalTraitChoices = new Map<string, { characterId: string; groupId: string; updatedAt: number }>()

interface SharedCharactersState {
  characters: Character[]
  selectedId: string | null
  updatedAt?: number
}

interface SharedTraitChoiceEvent {
  eventId: string
  sourceMode: 'player' | 'dm'
  characterId: string
  groupId: string
  options: TraitChoiceOption[]
  updatedAt: number
}

function traitChoicePendingKey(characterId: string, groupId: string): string {
  return `${characterId}:${groupId}`
}

function markLocalTraitChoicePending(characterId: string, groupId: string) {
  pendingLocalTraitChoices.set(traitChoicePendingKey(characterId, groupId), {
    characterId,
    groupId,
    updatedAt: Date.now(),
  })
}

function publishPlayerTraitChoice(characterId: string, groupId: string, options: TraitChoiceOption[]) {
  const event: SharedTraitChoiceEvent = {
    eventId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    sourceMode: 'player',
    characterId,
    groupId,
    options,
    updatedAt: Date.now(),
  }
  void publishSharedEvent<SharedTraitChoiceEvent>('character-trait-choice-player-to-dm', event)
}

function rollD4(count: number): number {
  let total = 0
  for (let i = 0; i < count; i += 1) total += 1 + Math.floor(Math.random() * 4)
  return total
}

function applyStillWatersHealingOnBreathShift(before: Character, after: Character): Character {
  const trait = findClassTrait(after, 'swiftShot')
  if (!trait || after.currentHp <= 0) return after
  const beforeState = calmBreathState(before)
  const afterState = calmBreathState(after)
  const switched =
    (beforeState === 'calm' && afterState === 'outOfBreath') ||
    (beforeState === 'outOfBreath' && afterState === 'calm')
  if (!switched) return after
  const heal = rollD4(Math.max(1, trait.level))
  if (heal <= 0) return after
  return { ...after, currentHp: Math.min(after.maxHp, after.currentHp + heal) }
}

export function mergePlayerWritableCharacter(local: Character, shared: Character): Character {
  return {
    ...local,
    currentHp: shared.currentHp,
    maxHp: shared.maxHp,
    tempHp: shared.tempHp,
    conditions: shared.conditions,
    actionPoints: shared.actionPoints,
    currentAP: shared.currentAP,
  }
}

/** 自定义规则战斗字段的默认值 */
function mergePendingLocalTraitChoices(sharedCharacters: Character[], localCharacters: Character[]): Character[] {
  if (!isPlayerPort() || pendingLocalTraitChoices.size === 0) return sharedCharacters
  const localById = new Map(localCharacters.map((ch) => [ch.id, ch]))
  const now = Date.now()

  return sharedCharacters.map((shared) => {
    const local = localById.get(shared.id)
    if (!local) return shared

    let shouldPreserveLocalChoice = false
    for (const [key, pending] of pendingLocalTraitChoices) {
      if (pending.characterId !== shared.id) continue
      if (shared.traitChoicesDone?.[pending.groupId]) {
        pendingLocalTraitChoices.delete(key)
        continue
      }
      const localHasChoice = !!local.traitChoicesDone?.[pending.groupId]
      const stillFresh = now - pending.updatedAt < 30000
      if (localHasChoice && stillFresh) {
        shouldPreserveLocalChoice = true
      } else {
        pendingLocalTraitChoices.delete(key)
      }
    }

    if (!shouldPreserveLocalChoice) return shared
    return finalizeCharacter({
      ...shared,
      traits: local.traits,
      traitChoicesDone: local.traitChoicesDone,
      archerLv1ChoiceDone: local.archerLv1ChoiceDone,
      archerLv3ChoiceDone: local.archerLv3ChoiceDone,
      featureUpgradePoints: local.featureUpgradePoints,
      skillRanks: local.skillRanks,
    })
  })
}

function combatDefaults() {
  return {
    saveDC: 12,
    actionPoints: 2, // 每回合行动点上限默认 2
    currentAP: 2,
    passivePerception: 10,
    inspiration: 0,
    mana: 0,
    maxMana: 0,
    traits: [] as Trait[],
    combatSkills: [] as CombatSkill[],
  }
}

function emptyCharacter(): Character {
  return {
    id: uid(),
    name: '新冒险者',
    player: '',
    avatar: '🧝',
    accent: 'from-arcane-500 to-arcane-600',
    race: '人类',
    charClass: '战士',
    level: 1,
    background: '士兵',
    experience: 0,
    reputation: 0,
    abilities: { str: 25, dex: 25, con: 25, int: 25, wis: 25, cha: 25 },
    savingThrows: [],
    skills: [],
    maxHp: 10,
    currentHp: 10,
    tempHp: 0,
    hitDice: '1d10',
    ac: 10,
    speed: 30,
    initiativeBonus: 0,
    ...combatDefaults(),
    conditions: [],
    notes: '',
    dmNotes: '',
    visibleToPlayers: true,
  }
}

function makeSkill(s: Partial<CombatSkill> & { name: string }): CombatSkill {
  return {
    id: uid(),
    emoji: '✨',
    description: '',
    apCost: 1,
    cooldown: 1,
    cdReduction: 0,
    remaining: 0,
    usedThisTurn: false,
    damageCount: 0,
    damageSides: 4,
    damageBonus: 0,
    ...s,
  }
}

/** 兜底：把旧的/不完整的角色数据补齐新字段 */
function normalizeCharacter(c: Partial<Character>): Character {
  const d = combatDefaults()
  return {
    ...emptyCharacter(),
    ...c,
    saveDC: c.saveDC ?? d.saveDC,
    actionPoints: c.actionPoints ?? d.actionPoints,
    currentAP: c.currentAP ?? c.actionPoints ?? d.currentAP,
    passivePerception: c.passivePerception ?? d.passivePerception,
    inspiration: c.inspiration ?? d.inspiration,
    mana: c.mana ?? d.mana,
    maxMana: c.maxMana ?? d.maxMana,
    traits: c.traits ?? [],
    combatSkills: (c.combatSkills ?? []).map((s) => {
      const skill = makeSkill(s)
      if (skill.name === '火球术' && skill.statusOnHit !== 'burning') {
        return { ...skill, statusOnHit: 'burning' as const, statusDuration: skill.statusDuration ?? 3 }
      }
      if (skill.name === '毒云术' && skill.statusOnHit !== 'poison') {
        return { ...skill, statusOnHit: 'poison' as const, statusDuration: skill.statusDuration ?? 4 }
      }
      return skill
    }),
    abilities: c.abilities ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    savingThrows: c.savingThrows ?? [],
    skills: c.skills ?? [],
    conditions: c.conditions ?? [],
    experience: c.experience ?? 0,
    reputation: c.reputation ?? 0,
    archerLv1ChoiceDone: c.archerLv1ChoiceDone ?? false,
    archerLv3ChoiceDone: c.archerLv3ChoiceDone ?? false,
    combatBuffs: c.combatBuffs ?? {},
    featureUpgradePoints: c.featureUpgradePoints ?? 0,
    skillRanks: c.skillRanks ?? {},
    traitChoicesDone: c.traitChoicesDone ?? {},
    qi: c.qi,
    equipment: c.equipment,
  } as Character
}

function applyMetaReward(c: Character, metaKey: MetaChoiceKey): Character {
  switch (metaKey) {
    case 'featureUpgrade':
      return { ...c, featureUpgradePoints: (c.featureUpgradePoints ?? 0) + 1 }
    case 'abilityBoost':
      return {
        ...c,
        traits: [
          ...c.traits,
          {
            id: uid(),
            name: '属性提升 +2',
            level: 1,
            uses: 0,
            maxUses: 0,
            description: '待分配 2 点属性值（由玩家/DM 在角色卡标注）。',
          },
        ],
      }
    case 'knowledgeBoost':
      return {
        ...c,
        traits: [
          ...c.traits,
          {
            id: uid(),
            name: '学识提升 +1',
            level: 1,
            uses: 0,
            maxUses: 0,
            description: '任选一项学识熟练提升 1 级。',
          },
        ],
      }
    case 'proficiencyBoost':
      return {
        ...c,
        traits: [
          ...c.traits,
          {
            id: uid(),
            name: '熟练项提升 +1',
            level: 1,
            uses: 0,
            maxUses: 0,
            description: '任选一项武器/工具/技能熟练提升 1 级。',
          },
        ],
      }
    case 'skillUpgrade':
      return {
        ...c,
        traits: [
          ...c.traits,
          {
            id: uid(),
            name: '技能阶位 +1',
            level: 1,
            uses: 0,
            maxUses: 0,
            description: '任选一项已学弓手技能树技能提升 1 阶。',
          },
        ],
      }
    default:
      return c
  }
}

/** 示例角色：从 SAMPLE 模板补全缺失的默认技能（不影响已有技能） */
function applyTraitChoiceToCharacter(
  character: Character,
  groupId: string,
  options: TraitChoiceOption[],
): Character {
  const group = TRAIT_CHOICE_GROUPS.find((g) => g.id === groupId)
  if (!group) return character

  let next = { ...character }
  const choicesDone = { ...(next.traitChoicesDone ?? {}), [groupId]: true }
  if (groupId === 'archer-lv1') next = { ...next, archerLv1ChoiceDone: true }
  if (groupId === 'archer-lv3') next = { ...next, archerLv3ChoiceDone: true }

  if (group.autoGrant?.length || group.autoGrantFeatures?.length) {
    for (const meta of group.autoGrant ?? []) {
      next = applyMetaReward(next, meta)
    }
    for (const fKey of group.autoGrantFeatures ?? []) {
      const exists = next.traits.some((t) => t.featureKey === fKey)
      if (!exists) {
        next = {
          ...next,
          traits: [...next.traits, createClassTrait(fKey, next.level)],
        }
      }
    }
  } else {
    for (const opt of options) {
      if (opt.kind === 'meta' && opt.metaKey) {
        next = applyMetaReward(next, opt.metaKey)
      } else if (opt.kind === 'feature' && opt.featureKey) {
        const exists = next.traits.some((t) => t.featureKey === opt.featureKey)
        if (!exists) {
          next = {
            ...next,
            traits: [...next.traits, createClassTrait(opt.featureKey, next.level)],
          }
        }
      }
    }
  }

  return syncArcherCombatSkills(syncQiForCharacter(syncArcherTraits({ ...next, traitChoicesDone: choicesDone })))
}

function mergeMissingSampleSkills(c: Character): Character {
  const template = SAMPLE.find((s) => s.id === c.id)
  if (!template) return c
  const names = new Set(c.combatSkills.map((s) => s.name))
  const missing = template.combatSkills.filter((s) => !names.has(s.name))
  if (missing.length === 0) return c
  return {
    ...c,
    combatSkills: [...c.combatSkills, ...missing.map((s) => makeSkill(s))],
  }
}

function finalizeCharacter(c: Partial<Character>): Character {
  return syncCombatDerivedStats(
    syncArcherCombatSkills(
      syncQiForCharacter(
        syncArcherTraits(
          migrateCharacterTraits(
            mergeMissingSampleSkills(
              refreshKnownEquipment(ensureDefaultEquipment(normalizeCharacter(c))),
            ),
          ),
        ),
      ),
    ),
  )
}

const SAMPLE: Character[] = [
  {
    id: 'sample-aria',
    name: '艾莉雅·星语',
    player: '小琳',
    avatar: '🧝‍♀️',
    accent: 'from-violet-500 to-fuchsia-600',
    race: '高等精灵',
    charClass: '法师',
    level: 5,
    background: '贤者',
    experience: 2800,
    reputation: 12,
    abilities: { str: 8, dex: 14, con: 13, int: 18, wis: 12, cha: 10 },
    savingThrows: ['int', 'wis'],
    skills: ['arcana', 'history', 'investigation', 'insight'],
    maxHp: 27,
    currentHp: 22,
    tempHp: 0,
    hitDice: '5d6',
    ac: 13,
    speed: 30,
    initiativeBonus: 0,
    saveDC: 15,
    actionPoints: 2,
    currentAP: 2,
    passivePerception: 13,
    inspiration: 2,
    mana: 0,
    maxMana: 0,
    traits: [
      {
        id: 't-aria-1',
        name: '奥术回涌',
        level: 1,
        uses: 1,
        maxUses: 1,
        description: '每短休一次，立即恢复 5 点魔力值。',
      },
      {
        id: 't-aria-2',
        name: '元素亲和（火）',
        level: 2,
        uses: 0,
        maxUses: 0,
        description: '被动：火焰类技能伤害 +2。',
      },
    ],
    combatSkills: [
      makeSkill({
        name: '奥术飞弹',
        emoji: '✨',
        apCost: 1,
        cooldown: 1,
        damageCount: 3,
        damageSides: 4,
        damageBonus: 0,
        description: '射出三发自动命中的魔法飞弹，每发 1d4 力场伤害。',
      }),
      makeSkill({
        name: '火球术',
        emoji: '🔥',
        apCost: 2,
        cooldown: 3,
        damageCount: 8,
        damageSides: 6,
        statusOnHit: 'burning',
        statusDuration: 3,
        description: '范围爆发，造成 8d6 火焰伤害，命中目标燃烧 3 回合。',
      }),
      makeSkill({ name: '法术护盾', emoji: '🛡️', apCost: 1, cooldown: 2, remaining: 1, description: '反应：AC +5，抵挡一次攻击。' }),
      makeSkill({
        name: '星界传送门',
        emoji: '🌀',
        apCost: 2,
        cooldown: 5,
        cdReduction: 1,
        remaining: 3,
        description: '开启短距传送门（法杖使冷却 -1）。',
      }),
    ],
    conditions: [],
    notes: '携带一本记载远古星辰魔法的法术书。',
    dmNotes: '其法术书暗藏通往星界裂隙的线索，第 7 章触发剧情。',
    visibleToPlayers: true,
  },
  {
    id: 'sample-thorne',
    name: '索恩·铁拳',
    player: '阿强',
    avatar: '🧔',
    accent: 'from-amber-500 to-orange-600',
    race: '山地矮人',
    charClass: '战士',
    level: 5,
    background: '士兵',
    experience: 1500,
    reputation: 8,
    abilities: { str: 17, dex: 12, con: 16, int: 9, wis: 11, cha: 8 },
    savingThrows: ['str', 'con'],
    skills: ['athletics', 'intimidation', 'survival'],
    maxHp: 47,
    currentHp: 47,
    tempHp: 5,
    hitDice: '5d10',
    ac: 18,
    speed: 25,
    initiativeBonus: 0,
    saveDC: 13,
    actionPoints: 2,
    currentAP: 2,
    passivePerception: 11,
    inspiration: 1,
    mana: 0,
    maxMana: 0,
    traits: [
      {
        id: 't-thorne-1',
        name: '二度风发',
        level: 1,
        uses: 1,
        maxUses: 1,
        description: '一个动作恢复 1d10 + 等级 生命值。',
      },
    ],
    combatSkills: [
      makeSkill({
        name: '强力打击',
        emoji: '⚔️',
        apCost: 1,
        cooldown: 2,
        damageCount: 2,
        damageSides: 6,
        damageBonus: 3,
        description: '蓄力一击，造成 2d6+3 伤害。',
      }),
      makeSkill({ name: '盾牌猛击', emoji: '🛡️', apCost: 1, cooldown: 1, damageCount: 1, damageSides: 4, description: '击晕敌人一回合，1d4 伤害。' }),
      makeSkill({ name: '战吼', emoji: '📢', apCost: 1, cooldown: 3, remaining: 2, description: '全队攻击 +1，持续 3 回合。' }),
    ],
    conditions: [],
    notes: '誓死守护队伍，握有一把家传战锤。',
    dmNotes: '其家族世仇是反派 BOSS，可用于剧情钩子。',
    visibleToPlayers: true,
  },
  {
    id: 'sample-adventurer',
    name: '新冒险者',
    player: '玩家',
    avatar: '🧝',
    accent: 'from-arcane-500 to-arcane-600',
    race: '人类',
    charClass: '战士',
    level: 1,
    background: '士兵',
    experience: 0,
    reputation: 0,
    abilities: { str: 25, dex: 25, con: 25, int: 25, wis: 25, cha: 25 },
    savingThrows: ['str'],
    skills: ['athletics', 'perception'],
    maxHp: 12,
    currentHp: 12,
    tempHp: 0,
    hitDice: '1d10',
    ac: 16,
    speed: 30,
    initiativeBonus: 1,
    saveDC: 12,
    actionPoints: 2,
    currentAP: 2,
    passivePerception: 12,
    inspiration: 0,
    mana: 0,
    maxMana: 0,
    traits: [createClassTrait('doubleArrow', 1)],
    combatSkills: [
      makeSkill({
        name: '近战攻击',
        emoji: '⚔️',
        apCost: 1,
        cooldown: 1,
        damageCount: 1,
        damageSides: 8,
        damageBonus: 1,
        description: '挥砍武器，造成 1d8+1 挥砍伤害。',
      }),
      makeSkill({
        name: '盾牌格挡',
        emoji: '🛡️',
        apCost: 1,
        cooldown: 2,
        damageCount: 0,
        description: '本回合 AC +2（占位，后续接入）。',
      }),
    ],
    conditions: [],
    notes: '初出茅庐的战士，正在学习战斗技巧。',
    dmNotes: '玩家默认操控角色。',
    visibleToPlayers: true,
  },
  {
    id: 'sample-archer',
    name: '莉娅·风弦',
    player: '',
    avatar: '🏹',
    accent: 'from-lime-500 to-emerald-600',
    race: '人类',
    charClass: '弓手',
    level: 3,
    background: '流浪者',
    experience: 600,
    reputation: 5,
    abilities: { str: 12, dex: 20, con: 14, int: 10, wis: 14, cha: 10 },
    savingThrows: ['dex', 'wis'],
    skills: ['perception', 'stealth', 'survival', 'acrobatics'],
    maxHp: 24,
    currentHp: 24,
    tempHp: 0,
    hitDice: '3d10',
    ac: 15,
    speed: 30,
    initiativeBonus: 3,
    saveDC: 13,
    actionPoints: 2,
    currentAP: 2,
    passivePerception: 15,
    inspiration: 1,
    mana: 0,
    maxMana: 0,
    traits: [createClassTrait('doubleArrow', 3), createClassTrait('eagleEye', 3)],
    combatSkills: [],
    skillRanks: {},
    conditions: [],
    notes: '弓手：升级至 2 级时可进行 LV1 特性抉择。',
    dmNotes: '测试：将等级从 1 升到 2 触发抉择弹窗。',
    archerLv1ChoiceDone: true,
    archerLv3ChoiceDone: true,
    visibleToPlayers: true,
  },
  {
    id: 'sample-vex',
    name: '薇克丝',
    player: '阿May',
    avatar: '🦊',
    accent: 'from-emerald-500 to-teal-600',
    race: '半身人',
    charClass: '游荡者',
    level: 4,
    background: '罪犯',
    experience: 900,
    reputation: 3,
    abilities: { str: 10, dex: 18, con: 12, int: 13, wis: 14, cha: 12 },
    savingThrows: ['dex', 'int'],
    skills: ['stealth', 'sleightOfHand', 'acrobatics', 'perception', 'deception'],
    maxHp: 27,
    currentHp: 14,
    tempHp: 0,
    hitDice: '4d8',
    ac: 15,
    speed: 30,
    initiativeBonus: 2,
    saveDC: 13,
    actionPoints: 2,
    currentAP: 2,
    passivePerception: 14,
    inspiration: 1,
    mana: 0,
    maxMana: 0,
    traits: [
      {
        id: 't-vex-1',
        name: '偷袭',
        level: 1,
        uses: 0,
        maxUses: 0,
        description: '被动：取得优势时额外 2d6 伤害。',
      },
    ],
    combatSkills: [
      makeSkill({
        name: '致命偷袭',
        emoji: '🗡️',
        apCost: 1,
        cooldown: 1,
        damageCount: 4,
        damageSides: 6,
        description: '从暗处发动，造成 4d6 偷袭伤害。',
      }),
      makeSkill({
        name: '毒云术',
        emoji: '☠️',
        apCost: 1,
        cooldown: 2,
        damageCount: 2,
        damageSides: 6,
        statusOnHit: 'poison',
        statusDuration: 4,
        description: '释放毒云，造成 2d6 毒性伤害，目标中毒 4 回合。',
      }),
      makeSkill({
        name: '烟雾弹',
        emoji: '💨',
        apCost: 1,
        cooldown: 3,
        cdReduction: 1,
        remaining: 0,
        description: '制造烟幕，脱离战斗（道具使冷却 -1）。',
      }),
    ],
    conditions: ['中毒'],
    notes: '行踪不定，口袋里总有几样来路不明的东西。',
    dmNotes: '欠了盗贼公会一笔债，随时可能被追杀。',
    visibleToPlayers: true,
  },
]

interface CharacterState {
  characters: Character[]
  selectedId: string | null
  loadShared: () => Promise<void>
  select: (id: string | null) => void
  add: (name?: string) => string
  importCharacter: (character: Partial<Character>) => string
  update: (id: string, patch: Partial<Character>) => void
  remove: (id: string) => void
  longRestAll: () => void

  // —— 技能冷却系统 ——
  useSkill: (charId: string, skillId: string, opts?: { waiveAp?: boolean }) => void
  /** 战斗开始：全部技能放入 0 栏（可用），行动点回满 */
  resetCombatCooldowns: (charId: string) => void
  /** 回合开始：行动点回满，清除本回合已用标记 */
  beginTurn: (charId: string) => void
  /** 结束回合：所有技能冷却 -1 */
  endTurn: (charId: string) => void
  /** 主动移动后触发气喘 */
  notifyCombatMove: (charId: string) => void
  /** @deprecated 请用 beginTurn / endTurn */
  advanceTurn: (charId: string) => void
  /** @deprecated 新回合边界不再全体减 CD（已在各自结束回合时处理） */
  advanceAllTurns: () => void
  reduceCooldown: (charId: string, skillId: string) => void // 激励骰
  damage: (charId: string, amount: number) => void // 对角色造成伤害
  spendAP: (charId: string, amount: number) => boolean
  addSkill: (charId: string) => void
  updateSkill: (charId: string, skillId: string, patch: Partial<CombatSkill>) => void
  removeSkill: (charId: string, skillId: string) => void

  // —— 特性 ——
  addTrait: (charId: string) => void
  updateTrait: (charId: string, traitId: string, patch: Partial<Trait>) => void
  removeTrait: (charId: string, traitId: string) => void
  useClassFeature: (charId: string, key: ClassFeatureKey) => boolean
  activateEagleEye: (charId: string) => boolean
  upgradeClassTrait: (charId: string, traitId: string) => boolean
  upgradeSkillRank: (charId: string, skillId: string) => boolean
  learnSkill: (charId: string, skillId: string) => boolean
  applyArcherLv1Choice: (charId: string, key: ClassFeatureKey) => void
  applyArcherLv3Choice: (charId: string, key: ClassFeatureKey) => void
  applyTraitChoice: (
    charId: string,
    groupId: string,
    options: TraitChoiceOption[],
    opts?: { fromRemote?: boolean },
  ) => void
  spendQi: (charId: string, amount?: number) => boolean
  useQiReduceCooldown: (charId: string, skillId: string) => boolean
}

export const useCharacterStore = create<CharacterState>()(
  persist(
    (set, get) => {
      const saveCharacters = () => {
        const seq = ++characterSaveSeq
        const save = async () => {
          let characters = get().characters
          if (isPlayerPort()) {
            const shared = await loadSharedResource<SharedCharactersState>('characters')
            if (seq !== characterSaveSeq) return
            if (shared?.characters) {
              const sharedById = new Map(shared.characters.map((ch) => [ch.id, ch]))
              characters = characters.map((ch) => {
                const sharedChar = sharedById.get(ch.id)
                if (!sharedChar) return ch
                return mergePlayerWritableCharacter(ch, sharedChar)
              })
              set({ characters })
            }
          }
          const payload: SharedCharactersState = {
            characters,
            selectedId: get().selectedId,
            updatedAt: Date.now(),
          }
          if (seq !== characterSaveSeq) return
          lastLocalCharactersWriteAt = payload.updatedAt ?? Date.now()
          lastSharedCharactersSnapshot = JSON.stringify(payload)
          await saveSharedResource('characters', payload)
        }
        void save()
      }

      const updateChar = (id: string, fn: (c: Character) => Character) =>
        {
          set((s) => ({ characters: s.characters.map((c) => (c.id === id ? fn(c) : c)) }))
          saveCharacters()
        }

      const mapSkill = (c: Character, skillId: string, fn: (s: CombatSkill) => CombatSkill) => ({
        ...c,
        combatSkills: c.combatSkills.map((s) => (s.id === skillId ? fn(s) : s)),
      })

      return {
        characters: SAMPLE,
        selectedId: 'sample-adventurer',
        loadShared: async () => {
          const shared = await loadSharedResource<SharedCharactersState>('characters')
          if (!shared?.characters) {
            saveCharacters()
            return
          }
          if (!isPlayerPort() && (shared.updatedAt ?? 0) < lastLocalCharactersWriteAt) {
            console.info('[characters-shared-stale-ignored]', {
              sharedUpdatedAt: shared.updatedAt ?? 0,
              lastLocalCharactersWriteAt,
            })
            return
          }
          // [T11/AC6 · E6] 单调 guard：严格更旧的乱序快照丢弃（DM 与玩家两端都生效）。
          const incomingUpdatedAt = shared.updatedAt ?? 0
          if (incomingUpdatedAt < lastAppliedCharactersUpdatedAt) return
          const snapshot = JSON.stringify(shared)
          // equality 短路只在内容真正未变时触发，不压制更新的 apply。
          if (snapshot === lastSharedCharactersSnapshot) return
          lastAppliedCharactersUpdatedAt = incomingUpdatedAt
          lastSharedCharactersSnapshot = snapshot
          // [T10/AC2 · E11] 先剔除仍被墓碑标记的角色：对端一份仍含已删角色的全量快照
          // 不得复活它。墓碑过期后（GC）该过滤自动失效，被删 id 可被复用。
          const sharedCharacters = filterTombstonedCharacters(shared.characters).map(finalizeCharacter)
          const localCharacters = get().characters
          const nextSelectedId = shared.selectedId ?? sharedCharacters[0]?.id ?? null
          set({
            characters: mergePendingLocalTraitChoices(sharedCharacters, localCharacters),
            selectedId:
              nextSelectedId && isCharacterTombstoned(nextSelectedId)
                ? (sharedCharacters[0]?.id ?? null)
                : nextSelectedId,
          })
          if (shared.updatedAt != null) lastLocalCharactersWriteAt = shared.updatedAt
        },
        select: (id) => set({ selectedId: id }),
        add: (name?: string) => {
          const c = emptyCharacter()
          const trimmed = name?.trim()
          if (trimmed) c.name = trimmed
          set((s) => ({ characters: [...s.characters, c], selectedId: c.id }))
          saveCharacters()
          return c.id
        },
        importCharacter: (character) => {
          const id = uid()
          const maxHp = Math.max(1, Number(character.maxHp ?? 10) || 10)
          const currentHp = Math.min(maxHp, Math.max(0, Number(character.currentHp ?? maxHp) || maxHp))
          const imported = finalizeCharacter({
            ...character,
            id,
            name: character.name?.trim() || 'Imported Adventurer',
            currentHp,
            maxHp,
            tempHp: Math.max(0, Number(character.tempHp ?? 0) || 0),
            conditions: character.conditions ?? [],
            combatBuffs: character.combatBuffs ?? {},
            visibleToPlayers: character.visibleToPlayers ?? true,
          })
          set((s) => ({ characters: [...s.characters, imported], selectedId: id }))
          saveCharacters()
          return id
        },
        update: (id, patch) =>
          updateChar(id, (c) =>
            syncCombatDerivedStats(
              syncArcherCombatSkills(syncArcherTraits(ensureDefaultEquipment({ ...c, ...patch }))),
            ),
          ),
        remove: (id) => {
          // [T10/AC2 · E11] 先立墓碑，再同步写出快照（不再 setTimeout(...,0) 异步写）。
          // 异步窗口曾是复活竞态的根源：删除已生效但快照尚未写出时，对端旧全量快照一旦在
          // loadShared 里被应用就会复活该角色。墓碑 + 同步 save 双保险关闭这个窗口。
          recordCharacterTombstone(id)
          set((s) => {
            const characters = s.characters.filter((c) => c.id !== id)
            return {
              characters,
              selectedId: s.selectedId === id ? (characters[0]?.id ?? null) : s.selectedId,
            }
          })
          saveCharacters()
        },
        longRestAll: () => {
          set((s) => ({
            characters: s.characters.map((c) =>
              syncQiForCharacter({
                ...c,
                currentHp: c.maxHp,
                tempHp: 0,
                currentAP: c.actionPoints,
                qi: maxQiForLevel(c.level),
                combatSkills: c.combatSkills.map((skill) => ({
                  ...skill,
                  remaining: 0,
                  usedThisTurn: false,
                })),
                traits: c.traits.map((trait) =>
                  trait.maxUses > 0 ? { ...trait, uses: trait.maxUses } : trait,
                ),
              }),
            ),
          }))
          saveCharacters()
        },

        useSkill: (charId, skillId, opts) => {
          const c = get().characters.find((x) => x.id === charId)
          const skill = c?.combatSkills.find((s) => s.id === skillId)
          if (!c || !skill) return
          if (skill.remaining > 0 || (skill.usedThisTurn && skill.cooldown > 0)) return
          const waiveAp = !!opts?.waiveAp
          if (!waiveAp && c.currentAP < skill.apCost) return
          const remaining = skillCooldownRemaining(skill)
          updateChar(charId, (ch) => ({
            ...mapSkill(ch, skillId, (s) => ({
              ...s,
              remaining,
              usedThisTurn: skill.cooldown > 0,
            })),
            currentAP: waiveAp ? ch.currentAP : ch.currentAP - skill.apCost,
          }))
        },

        resetCombatCooldowns: (charId) =>
          updateChar(charId, (c) => {
            const hasRuneArrow = !!findClassTrait(c, 'runeArrow')
            let runeArrowApplied = false
            const reset = resetCombatTraitUses({
              ...c,
              currentAP: c.actionPoints,
              combatSkills: c.combatSkills.map((s) => {
                const runeReset = hasRuneArrow && !runeArrowApplied && isMagicDamageSkill(s)
                if (runeReset) runeArrowApplied = true
                return {
                  ...s,
                  remaining: runeReset ? 0 : skillCooldownRemaining(s),
                  usedThisTurn: false,
                }
              }),
            })
            return applyStillWatersHealingOnBreathShift(reset, {
              ...reset,
              combatBuffs: initCalmMindForCombat(reset),
            })
          }),

        beginTurn: (charId) =>
          updateChar(charId, (c) => {
            let combatBuffs = beginCalmMindTurn(c)
            const eagleTurns = combatBuffs.eagleEyeTurns ?? 0
            if (eagleTurns > 0) {
              const next = eagleTurns - 1
              combatBuffs = { ...combatBuffs, eagleEyeTurns: next > 0 ? next : undefined }
            }
            console.info('[character-ap-begin-turn]', {
              charId,
              name: c.name,
              before: c.currentAP,
              after: c.currentAP,
              max: c.actionPoints,
            })
            return {
              ...c,
              combatBuffs: {
                ...combatBuffs,
                steadyDrawUsedThisTurn: undefined,
                movedFeetThisTurn: undefined,
                tookDamageThisTurn: undefined,
              },
              combatSkills: c.combatSkills.map((s) => ({ ...s, usedThisTurn: false })),
            }
          }),

        endTurn: (charId) =>
          updateChar(charId, (c) => {
            const beforeTick = c.combatBuffs ?? {}
            const firstCalmMindCheck =
              !!beforeTick.calmMindFirstTurnPending && !!findClassTrait(c, 'calmMind')
            const canGainInitialCalmMind =
              firstCalmMindCheck &&
              !beforeTick.movedFeetThisTurn &&
              !beforeTick.tookDamageThisTurn &&
              (beforeTick.outOfBreathTurns ?? 0) <= 0
            const checkedBuffs = firstCalmMindCheck
              ? {
                  ...beforeTick,
                  calmMind: canGainInitialCalmMind ? true : undefined,
                  calmMindFirstTurnPending: undefined,
                }
              : beforeTick
            const calmSpirit = findClassTrait(c, 'calmSpirit')
            const calmStacks =
              calmSpirit && isCalmMindActive({ ...c, combatBuffs: checkedBuffs })
                ? Math.min(4, (checkedBuffs.calmSpiritStacks ?? 0) + 1)
                : checkedBuffs.calmSpiritStacks
            const stillWaterTempTurns = checkedBuffs.stillWaterTempHpTurns ?? 0
            const nextStillWaterTempTurns = stillWaterTempTurns > 0 ? stillWaterTempTurns - 1 : 0
            const stillWaterTempExpired = stillWaterTempTurns > 0 && nextStillWaterTempTurns <= 0
            return applyStillWatersHealingOnBreathShift(c, {
              ...c,
              tempHp: stillWaterTempExpired ? 0 : c.tempHp,
              combatBuffs: {
                ...tickOutOfBreathOnEndTurn({ ...c, combatBuffs: checkedBuffs }),
                calmSpiritStacks: calmStacks && calmStacks > 0 ? calmStacks : undefined,
                stillWaterTempHpTurns: nextStillWaterTempTurns > 0 ? nextStillWaterTempTurns : undefined,
                galeComboReady: undefined,
              },
              combatSkills: c.combatSkills.map((s) => ({
                ...s,
                remaining: Math.max(0, s.remaining - 1),
              })),
            })
          }),

        /** 主动移动后触发气喘（由地图层调用） */
        notifyCombatMove: (charId) =>
          updateChar(charId, (c) =>
            applyStillWatersHealingOnBreathShift(c, {
              ...c,
              combatBuffs: {
                ...triggerOutOfBreath(c, 'move'),
                movedFeetThisTurn: Math.max(1, c.combatBuffs?.movedFeetThisTurn ?? 0),
              },
            }),
          ),

        advanceTurn: (charId) => {
          get().endTurn(charId)
          get().beginTurn(charId)
        },

        advanceAllTurns: () =>
          set((s) => ({
            characters: s.characters.map((c) => ({
              ...c,
              currentAP: c.actionPoints,
              combatSkills: c.combatSkills.map((sk) => ({
                ...sk,
                remaining: Math.max(0, sk.remaining - 1),
                usedThisTurn: false,
              })),
            })),
          })),

        damage: (charId, amount) =>
          updateChar(charId, (c) => {
            let remaining = amount
            const currentTemp = c.tempHp ?? 0
            const temp = Math.max(0, currentTemp - remaining)
            remaining = Math.max(0, remaining - currentTemp)
            const nextHp = Math.max(0, (c.currentHp ?? 0) - remaining)
            const tookDamage = amount > 0 && nextHp < c.currentHp
            return applyStillWatersHealingOnBreathShift(c, {
              ...c,
              tempHp: temp,
              currentHp: nextHp,
              combatBuffs: tookDamage
                ? { ...triggerOutOfBreath(c, 'damage'), tookDamageThisTurn: true }
                : c.combatBuffs,
            })
          }),

        spendAP: (charId, amount) => {
          const c = get().characters.find((x) => x.id === charId)
          if (!c || amount <= 0 || c.currentAP < amount) return false
          console.info('[character-ap-spend]', {
            charId,
            name: c.name,
            amount,
            before: c.currentAP,
            after: c.currentAP - amount,
            max: c.actionPoints,
          })
          updateChar(charId, (ch) => ({ ...ch, currentAP: ch.currentAP - amount }))
          return true
        },

        reduceCooldown: (charId, skillId) => {
          const c = get().characters.find((x) => x.id === charId)
          const skill = c?.combatSkills.find((s) => s.id === skillId)
          if (!c || !skill) return
          if (c.inspiration <= 0 || skill.remaining <= 0) return
          updateChar(charId, (ch) => ({
            ...mapSkill(ch, skillId, (s) => ({ ...s, remaining: Math.max(0, s.remaining - 1) })),
            inspiration: ch.inspiration - 1,
          }))
        },

        addSkill: (charId) =>
          updateChar(charId, (c) => ({
            ...c,
            combatSkills: [...c.combatSkills, makeSkill({ name: '新技能' })],
          })),

        updateSkill: (charId, skillId, patch) =>
          updateChar(charId, (c) => mapSkill(c, skillId, (s) => ({ ...s, ...patch }))),

        removeSkill: (charId, skillId) =>
          updateChar(charId, (c) => ({
            ...c,
            combatSkills: c.combatSkills.filter((s) => s.id !== skillId),
          })),

        addTrait: (charId) =>
          updateChar(charId, (c) => ({
            ...c,
            traits: [
              ...c.traits,
              { id: uid(), name: '新特性', level: 1, uses: 0, maxUses: 0, description: '' },
            ],
          })),

        updateTrait: (charId, traitId, patch) =>
          updateChar(charId, (c) => ({
            ...c,
            traits: c.traits.map((t) => (t.id === traitId ? { ...t, ...patch } : t)),
          })),

        removeTrait: (charId, traitId) =>
          updateChar(charId, (c) => ({
            ...c,
            traits: c.traits.filter((t) => t.id !== traitId),
          })),

        useClassFeature: (charId, key) => {
          const c = get().characters.find((x) => x.id === charId)
          const trait = c ? findClassTrait(c, key) : undefined
          if (!trait || trait.uses <= 0) return false
          updateChar(charId, (ch) => ({
            ...ch,
            traits: ch.traits.map((t) =>
              t.featureKey === key ? { ...t, uses: Math.max(0, t.uses - 1) } : t,
            ),
          }))
          return true
        },

        activateEagleEye: (charId) => {
          const c = get().characters.find((x) => x.id === charId)
          const trait = c ? findClassTrait(c, 'eagleEye') : undefined
          if (!c || !trait || trait.uses <= 0) return false
          updateChar(charId, (ch) => ({
            ...ch,
            combatBuffs: { ...ch.combatBuffs, eagleEyeTurns: 3 },
            traits: ch.traits.map((t) =>
              t.featureKey === 'eagleEye'
                ? { ...t, uses: Math.max(0, t.uses - 1) }
                : t,
            ),
          }))
          return true
        },

        upgradeClassTrait: (charId, traitId) => {
          const c = get().characters.find((x) => x.id === charId)
          const trait = c?.traits.find((t) => t.id === traitId)
          if (!c || !trait?.featureKey || (c.featureUpgradePoints ?? 0) <= 0) return false
          if (trait.level >= MAX_FEATURE_LEVEL) return false
          updateChar(charId, (ch) => {
            const traits = ch.traits.map((t) =>
              t.id === traitId ? applyTraitFeatureRank(t, t.level + 1) : t,
            )
            const next = syncArcherTraits({ ...ch, traits })
            return syncArcherCombatSkills({
              ...next,
              featureUpgradePoints: availableFeatureUpgradePoints(next),
            })
          })
          return true
        },

        upgradeSkillRank: (charId, skillId) => {
          const c = get().characters.find((x) => x.id === charId)
          if (!c || !canUpgradeSkillRank(c, skillId)) return false
          updateChar(charId, (ch) =>
            syncArcherCombatSkills({
              ...ch,
              skillRanks: {
                ...ch.skillRanks,
                [skillId]: getSkillRank(ch, skillId) + 1,
              },
            }),
          )
          return true
        },

        learnSkill: (charId, skillId) => {
          const c = get().characters.find((x) => x.id === charId)
          if (!c || !canLearnSkill(c, skillId)) return false
          updateChar(charId, (ch) =>
            syncArcherCombatSkills({
              ...ch,
              skillRanks: {
                ...ch.skillRanks,
                [skillId]: 1,
              },
            }),
          )
          return true
        },

        applyArcherLv1Choice: (charId, key) => {
          get().applyTraitChoice(charId, 'archer-lv1', [
            { kind: 'feature', featureKey: key, label: '', description: '' },
          ])
        },

        applyArcherLv3Choice: (charId, key) => {
          get().applyTraitChoice(charId, 'archer-lv3', [
            { kind: 'feature', featureKey: key, label: '', description: '' },
          ])
        },

        applyTraitChoice: (charId, groupId, options, opts) => {
          const c = get().characters.find((x) => x.id === charId)
          if (!c || !TRAIT_CHOICE_GROUPS.some((g) => g.id === groupId)) return

          updateChar(charId, (ch) => applyTraitChoiceToCharacter(ch, groupId, options))

          if (isPlayerPort() && !opts?.fromRemote) {
            markLocalTraitChoicePending(charId, groupId)
            publishPlayerTraitChoice(charId, groupId, options)
          }
        },

        spendQi: (charId, amount = 1) => {
          const c = get().characters.find((x) => x.id === charId)
          if (!c || (c.qi ?? 0) < amount) return false
          updateChar(charId, (ch) => ({ ...ch, qi: (ch.qi ?? 0) - amount }))
          return true
        },

        useQiReduceCooldown: (charId, skillId) => {
          const c = get().characters.find((x) => x.id === charId)
          const skill = c?.combatSkills.find((s) => s.id === skillId)
          if (!c || !skill || skill.remaining <= 0) return false
          if (!get().spendQi(charId, 1)) return false
          updateChar(charId, (ch) =>
            mapSkill(ch, skillId, (s) => ({
              ...s,
              remaining: Math.max(0, s.remaining - 1),
            })),
          )
          return true
        },
      }
    },
    {
      name: 'stars-characters',
      version: 19,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<CharacterState>
        let characters = (p.characters ?? []).map((c) => finalizeCharacter(c))
        if (version < 5) {
          const archer = SAMPLE.find((s) => s.id === 'sample-archer')
          if (archer && !characters.some((c) => c.id === 'sample-archer')) {
            characters = [...characters, finalizeCharacter(archer)]
          }
        }
        if (version < 6) {
          characters = characters.map((c) => {
            if (c.id !== 'sample-archer') return c
            const hasClassFeat = c.traits.some((t) => t.featureKey)
            return { ...c, archerLv1ChoiceDone: hasClassFeat || c.archerLv1ChoiceDone }
          })
        }
        if (version < 7) {
          const adventurer = SAMPLE.find((s) => s.id === 'sample-adventurer')
          if (adventurer && !characters.some((c) => c.id === 'sample-adventurer')) {
            characters = [...characters, finalizeCharacter(adventurer)]
          }
        }
        if (version < 8) {
          characters = characters.map((c) => {
            if (c.id !== 'sample-adventurer') return c
            if (c.traits.some((t) => t.featureKey === 'doubleArrow')) return c
            return syncArcherTraits({
              ...c,
              traits: [...c.traits, createClassTrait('doubleArrow', c.level)],
            })
          })
        }
        if (version < 9) {
          characters = characters.map((c) => syncArcherTraits(normalizeCharacter(c)))
        }
        if (version < 10) {
          characters = characters.map((c) => {
            const n = normalizeCharacter(c)
            if (!n.charClass.includes('弓手')) return n
            const hasLv3 = n.traits.some(
              (t) => t.featureKey === 'eagleEye' || t.featureKey === 'stableMind',
            )
            if (!hasLv3) return { ...n, archerLv3ChoiceDone: n.archerLv3ChoiceDone ?? false }
            const eagle = n.traits.find((t) => t.featureKey === 'eagleEye')
            const stable = n.traits.find((t) => t.featureKey === 'stableMind')
            if (eagle && stable) {
              const traits = n.traits.filter((t) => t.featureKey !== 'stableMind')
              return syncArcherTraits({ ...n, traits, archerLv3ChoiceDone: true })
            }
            return syncArcherTraits({ ...n, archerLv3ChoiceDone: true })
          })
        }
        if (version < 11) {
          characters = characters.map((c) => {
            const n = normalizeCharacter(c)
            if (!n.charClass.includes('弓手')) return n
            const double = n.traits.find((t) => t.featureKey === 'doubleArrow')
            const armor = n.traits.find((t) => t.featureKey === 'armorPiercingArrow')
            if (double && armor) {
              const traits = n.traits.filter((t) => t.featureKey !== 'armorPiercingArrow')
              return syncArcherTraits({ ...n, traits, archerLv1ChoiceDone: true })
            }
            if (double || armor) {
              return syncArcherTraits({ ...n, archerLv1ChoiceDone: true })
            }
            return n
          })
        }
        if (version < 12) {
          characters = characters.map((c) => {
            const n = normalizeCharacter(c)
            const classTraits = n.traits.filter((t) => t.featureKey)
            const earned = featureUpgradePointsEarned(n.level)
            const oldRank = classTraits.length
              ? Math.max(1, ...classTraits.map((t) => t.level))
              : 1
            const spent = Math.max(0, oldRank - 1)
            const traits = n.traits.map((t) =>
              t.featureKey ? applyTraitFeatureRank(t, oldRank) : t,
            )
            return syncArcherTraits({
              ...n,
              traits,
              featureUpgradePoints: Math.max(0, earned - spent),
            })
          })
        }
        if (version < 13) {
          characters = characters.map((c) => syncArcherCombatSkills(normalizeCharacter(c)))
        }
        if (version < 14) {
          characters = characters.map((c) => syncArcherCombatSkills(normalizeCharacter(c)))
        }
        if (version < 15) {
          characters = characters.map((c) => {
            let n = normalizeCharacter(c)
            const choicesDone: Record<string, boolean> = { ...(n.traitChoicesDone ?? {}) }
            if (n.archerLv1ChoiceDone) choicesDone['archer-lv1'] = true
            if (n.archerLv3ChoiceDone) choicesDone['archer-lv3'] = true
            n = {
              ...n,
              traitChoicesDone: choicesDone,
              traits: n.traits.map((t) => {
                if (t.featureKey !== 'stableMind') return t
                return createClassTrait('steadyDraw', n.level)
              }),
            }
            return syncArcherCombatSkills(syncQiForCharacter(syncArcherTraits(n)))
          })
        }
        if (version < 16) {
          characters = characters.map((c) =>
            syncArcherCombatSkills(syncQiForCharacter(migrateCharacterTraits(normalizeCharacter(c)))),
          )
        }
        if (version < 17) {
          characters = characters.map((c) => {
            const n = syncArcherTraits(normalizeCharacter(c))
            return {
              ...n,
              featureUpgradePoints: availableFeatureUpgradePoints(n),
            }
          })
        }
        if (version < 18) {
          characters = characters.map((c) => finalizeCharacter(c))
        }
        if (version < 19) {
          characters = characters.map((c) => finalizeCharacter(c))
        }
        return { ...p, characters } as CharacterState
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<CharacterState>
        return {
          ...current,
          ...p,
          characters: (p.characters ?? current.characters).map(finalizeCharacter),
        }
      },
    },
  ),
)

export function startCharacterTraitChoiceSync(): () => void {
  if (traitChoiceSyncStarted) return () => {}
  if (modeFromPort() !== 'dm') return () => {}

  traitChoiceSyncStarted = true
  stopTraitChoiceSync = subscribeSharedEvent<SharedTraitChoiceEvent>(
    'character-trait-choice-player-to-dm',
    (event) => {
      if (
        !event ||
        event.sourceMode !== 'player' ||
        Date.now() - event.updatedAt > 300000 ||
        seenTraitChoiceEventIds.has(event.eventId)
      ) {
        return
      }
      seenTraitChoiceEventIds.add(event.eventId)
      if (seenTraitChoiceEventIds.size > 500) {
        seenTraitChoiceEventIds.clear()
      }

      const state = useCharacterStore.getState()
      const character = state.characters.find((ch) => ch.id === event.characterId)
      if (!character || character.traitChoicesDone?.[event.groupId]) return
      state.applyTraitChoice(event.characterId, event.groupId, event.options, { fromRemote: true })
    },
  )

  return () => {
    stopTraitChoiceSync?.()
    stopTraitChoiceSync = null
    traitChoiceSyncStarted = false
  }
}
