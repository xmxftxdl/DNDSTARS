import type { Character, Trait } from '../types/character'
import { isShadowDancer } from './characterClasses'
import { isArcherLineClass } from './archerSkillTree'

/** 职业特性键（弓手 / 逐风者 / 影舞者） */
export const CLASS_FEATURE_KEYS = [
  // —— 弓手 ——
  'doubleArrow',
  'armorPiercingArrow',
  'stableMind',
  'eagleEye',
  'preciseStrike',
  'galeCombo',
  'agileLeap',
  'wildernessGuide',
  'piercingInsight',
  'silentDraw',
  // —— 逐风者 ——
  'animalMastery',
  'calmMind',
  'arcaneSurge',
  'huntingMark',
  'arcaneDevour',
  'calmSpirit',
  'trackingArrow',
  'explosiveArrow',
  'swiftShot',
  'huntingCombo',
  'swiftRecall',
  'vengeanceBlood',
  'runeArrow',
  'focusedSpirit',
  'shadowVeil',
  'stillWater',
  'finale',
  'arcaneDance',
  // —— 影舞者 ——
  'galeDancer',
  'takeoff',
  'comboFist',
  'multiStrike',
  'illusionDance',
  'flexibleBody',
  'waterWalk',
  'heavyFist',
  'critBlock',
  'fateShackle',
  'showtime',
  'windBlade',
  'transcendentSoul',
  // —— 已废弃（迁移用） ——
  'steadyDraw',
  'swiftStep',
  'natureWhisper',
  'flawObservation',
  'fatalChain',
  'calmingAura',
  'lastingControl',
] as const

export type ClassFeatureKey = (typeof CLASS_FEATURE_KEYS)[number]

export type TraitUsage = 'perCombat' | 'perDay' | 'perLongRest' | 'passive' | 'unlimited'

export interface ClassFeatureDef {
  key: ClassFeatureKey
  name: string
  description: string
  usage: TraitUsage
  maxUsesAtRank?: (featureRank: number, charLevel?: number) => number
  rangeAtRank?: (featureRank: number) => number
  diceAtRank?: (featureRank: number) => number
  valueAtRank?: (featureRank: number) => number
  /** 不在抉择面板展示（仅兼容旧存档） */
  deprecated?: boolean
}

export type MetaChoiceKey =
  | 'knowledgeBoost'
  | 'abilityBoost'
  | 'proficiencyBoost'
  | 'featureUpgrade'
  | 'skillUpgrade'

export interface TraitChoiceOption {
  kind: 'feature' | 'meta'
  featureKey?: ClassFeatureKey
  metaKey?: MetaChoiceKey
  label: string
  description: string
}

export interface TraitChoiceGroup {
  id: string
  title: string
  hint: string
  minLevel: number
  pickCount: number
  autoGrant?: MetaChoiceKey[]
  autoGrantFeatures?: ClassFeatureKey[]
  options: TraitChoiceOption[]
  applies: (c: Character) => boolean
}

export const MAX_FEATURE_LEVEL = 4

export const FEATURE_RANK_THRESHOLDS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] as const

const META_LABELS: Record<MetaChoiceKey, { label: string; description: string }> = {
  knowledgeBoost: {
    label: '自选学识 +1',
    description: '任选一项学识熟练提升 1 级（由 DM 或玩家在角色卡上标注）。',
  },
  abilityBoost: {
    label: '属性值 +2',
    description: '获得 2 点属性值提升，可自由分配至任意属性（上限 100）。',
  },
  proficiencyBoost: {
    label: '自选熟练项 +1',
    description: '任选一项武器/工具/技能熟练提升 1 级。',
  },
  featureUpgrade: {
    label: '自选特性 +1',
    description: '消耗后立即获得 1 个特性升级点，用于提升已有职业特性等级。',
  },
  skillUpgrade: {
    label: '自选技能 +1',
    description: '任选一项已学弓手技能树技能提升 1 阶。',
  },
}

const perLongRestPlusOne = (rank: number) => rank
const perCombatPlusOne = (rank: number) => rank
const diceEqualsRank = (rank: number) => rank
const diceCap3 = (rank: number) => Math.min(3, rank)

export function piercingInsightHpThresholdPercent(rank: number): number {
  if (rank >= 4) return 50
  if (rank >= 3) return 40
  if (rank >= 2) return 25
  return 20
}

export function piercingInsightExtraD4(rank: number): number {
  if (rank >= 4) return 3
  if (rank >= 2) return 2
  return 1
}

function metaOption(key: MetaChoiceKey): TraitChoiceOption {
  const m = META_LABELS[key]
  return { kind: 'meta', metaKey: key, label: m.label, description: m.description }
}

function feat(key: ClassFeatureKey, def: ClassFeatureDef): TraitChoiceOption {
  return {
    kind: 'feature',
    featureKey: key,
    label: def.name,
    description: formatFeatureDescription(def, 1),
  }
}

export const CLASS_FEATURE_DEFS: ClassFeatureDef[] = [
  // —— 弓手 ——
  {
    key: 'doubleArrow',
    name: '双箭',
    usage: 'perLongRest',
    description:
      '当你释放只发射一枚箭矢的远程普通射击时，你可以将发射的箭矢改为两支，并额外造成 1D4 点穿刺伤害。每日 {uses} 次；每提升 1 级，每日使用上限 +1。提升至 3 级时，额外伤害改为 1D6 点穿刺伤害。',
    maxUsesAtRank: (r) => r + 1,
  },
  {
    key: 'armorPiercingArrow',
    name: '穿甲箭',
    usage: 'perLongRest',
    description:
      '当你释放只发射一枚箭矢的远程基础射击造成重击时，可对目标后方直线距离 15 尺内的所有角色造成等同于本次伤害一半的伤害。每提升 1 级，该特性可额外使用 1 次。',
    maxUsesAtRank: (r) => r,
  },
  {
    key: 'stableMind',
    name: '残影脱身',
    usage: 'perLongRest',
    description:
      '当你进行敏捷豁免成功，但仍会受到伤害后，可以消耗 1 AP 取消本次攻击受到的所有伤害。每提升 1 级特性，长休可额外使用 1 次。',
    maxUsesAtRank: perLongRestPlusOne,
  },
  {
    key: 'eagleEye',
    name: '鹰眼',
    usage: 'perLongRest',
    description:
      '3 回合内将你的敏捷值临时增加 {value} 点；每提升 1 级特性，提升的临时敏捷值额外增加 5 点。',
    maxUsesAtRank: () => 2,
    valueAtRank: (r) => 10 + (r - 1) * 5,
  },
  {
    key: 'preciseStrike',
    name: '精准打击',
    usage: 'perLongRest',
    description:
      '使得下一次攻击必定造成重击。长休可使用 1 次；每提升 1 级特性，长休可额外使用 1 次。',
    maxUsesAtRank: perLongRestPlusOne,
  },
  {
    key: 'galeCombo',
    name: '疾风连击',
    usage: 'perLongRest',
    description:
      '当你对敌对角色施加倒地/击飞状态且对方豁免失败时，可以发动疾风连击。发动后，下一次已准备技能或基础射击不消耗 AP；释放后消耗 1 次使用次数。该特性长休可使用 1 次；每提升 1 级，使用上限 +1。',
    maxUsesAtRank: perLongRestPlusOne,
  },
  {
    key: 'agileLeap',
    name: '灵巧跳跃',
    usage: 'perLongRest',
    description:
      '每当你闪避成功时，可无需消耗 AP 移动 10 尺，无视困难地形和障碍物。该特性长休可使用 2 次；每提升 1 级特性，移动距离增加 5 尺。',
    maxUsesAtRank: () => 2,
    rangeAtRank: (r) => 10 + (r - 1) * 5,
  },
  {
    key: 'wildernessGuide',
    name: '荒野指引者',
    usage: 'perLongRest',
    description:
      '你熟悉自然之道：白天求生鉴定具有优势，野外察觉鉴定获得优势。若拥有黑暗视觉，夜晚求生鉴定同样获得优势。该特性长休可使用 1 次特殊指引；每提升 1 级可额外使用 1 次。',
    maxUsesAtRank: perLongRestPlusOne,
  },
  {
    key: 'piercingInsight',
    name: '看破！',
    usage: 'passive',
    description:
      '当你攻击一名生命值少于 {value}% 的敌人时，额外造成 {dice}D4 点穿刺伤害。',
    valueAtRank: piercingInsightHpThresholdPercent,
    diceAtRank: piercingInsightExtraD4,
  },
  {
    key: 'silentDraw',
    name: '无声起弦',
    usage: 'passive',
    description:
      '若你在战斗中的先攻顺序第一个行动，则本场战斗的第一次攻击额外造成 {dice}D6 点同类型伤害。每提升 1 级特性，额外造成 1D6 点伤害。',
    diceAtRank: diceEqualsRank,
  },
  // —— 逐风者 ——
  {
    key: 'animalMastery',
    name: '动物学专精',
    usage: 'passive',
    description:
      '你知晓动物的弱点及行动方式。与动物或类动物生物战斗时，额外造成 {dice}D6 点同类型伤害。每提升 1 级增加 1D6。',
    diceAtRank: diceEqualsRank,
  },
  {
    key: 'calmMind',
    name: '静心',
    usage: 'passive',
    description:
      '当你未处于气喘状态时，获得静心状态，每次攻击的伤害骰增加 {dice}D6。每当你受到攻击或者主动移动后，获得气喘状态，你的所有攻击获得劣势，直至你下一回合结束。每提升 1 级增加 1D6。',
    diceAtRank: diceEqualsRank,
  },
  {
    key: 'arcaneSurge',
    name: '魔法浪涌',
    usage: 'perLongRest',
    description:
      '你获得使用魔法卷轴的能力。当你受到致命伤害时，可烧毁一枚卷轴而将生命值改为 1。每提升 1 级，长休可额外使用 1 次。',
    maxUsesAtRank: perLongRestPlusOne,
  },
  {
    key: 'huntingMark',
    name: '狩猎印记',
    usage: 'passive',
    description:
      '每当你对一名敌对生物造成伤害后，附着 1 枚狩猎印记（最多 4 层）。攻击带印记生物时额外造成 {dice}D8 伤害；被带印记生物攻击时额外受到 {dice}D4 伤害。每提升 1 级各 +1D8/+1D4。',
    diceAtRank: diceEqualsRank,
  },
  {
    key: 'arcaneDevour',
    name: '魔能吞噬',
    usage: 'passive',
    description:
      '当你射出带有魔法伤害的箭矢时，对所有受到伤害的目标额外造成 {dice}D6 点无属性魔法伤害。每提升 1 级增加 1D6。',
    diceAtRank: diceEqualsRank,
  },
  {
    key: 'calmSpirit',
    name: '安定心神',
    usage: 'passive',
    description:
      '每次保持静心状态结束回合时获得 1 层静心标记（上限 4）。可消耗标记：1 枚移动至 10 尺（每级 +5 尺）；2 枚暴击率 +20%（每级 +10%）；3 枚一项技能 CD -1；4 枚再获得一个完整回合。',
  },
  {
    key: 'trackingArrow',
    name: '追踪箭',
    usage: 'perLongRest',
    description:
      '选择一名带狩猎印记的生物时，只要其在攻击范围内，始终视为可见，并额外给予 1 枚狩猎印记。长休前 {uses} 次；每次升级 +1 长休上限。',
    maxUsesAtRank: perLongRestPlusOne,
  },
  {
    key: 'explosiveArrow',
    name: '爆裂箭矢',
    usage: 'passive',
    description:
      '若攻击造成重击，额外造成 {dice}D12 点火焰伤害并叠加 1 层火焰标记。每提升 1 级额外 +1D12。',
    diceAtRank: diceEqualsRank,
  },
  {
    key: 'swiftShot',
    name: '波澜不惊',
    usage: 'passive',
    description:
      '当战斗开始时，默认处于静心状态。每当你切换静心/气喘状态时，回复 {dice}D4 点生命值。每提升 1 级，额外回复 1D4 点生命值。',
    diceAtRank: diceEqualsRank,
  },
  {
    key: 'huntingCombo',
    name: '狩猎连击',
    usage: 'passive',
    description:
      '当你攻击带有狩猎印记的生物时，忽视其闪避值，并增加 20% 暴击伤害。每提升 1 级额外 +5% 暴击伤害。',
  },
  {
    key: 'swiftRecall',
    name: '迅捷回溯',
    usage: 'passive',
    description:
      '当你使用魔法攻击成功使一名生物获得异常状态时，你获得 1 枚通用令牌（可用于减少 1 项技能 CD 或额外 1 AP，由 DM 裁定）。',
  },
  {
    key: 'vengeanceBlood',
    name: '复仇之血',
    usage: 'perLongRest',
    deprecated: true,
    description:
      '每当你对带狩猎印记的生物造成伤害时，可回复等同于本次伤害一半的生命值。长休前 {uses} 次；每次升级 +1 次。',
    maxUsesAtRank: perLongRestPlusOne,
  },
  {
    key: 'runeArrow',
    name: '符文箭',
    usage: 'passive',
    description:
      '在每场战斗开始前，你可以将一项会造成魔法伤害的技能的冷却值调整为 0。',
  },
  {
    key: 'focusedSpirit',
    name: '集中精神',
    usage: 'perLongRest',
    description:
      '当你被命中时，静心状态不会被打断。长休前可使用 2 次；每提升 1 级，长休前使用上限 +1。',
    maxUsesAtRank: (r) => r + 1,
  },
  {
    key: 'shadowVeil',
    name: '影遁之术',
    usage: 'perCombat',
    description:
      '消耗一名敌对生物身上 2 枚狩猎印记，在本回合内遮蔽其视野；该生物需投掷命中骰对抗你的豁免 DC，你对其所有攻击无法被闪避且额外造成 1D6 点伤害。',
    maxUsesAtRank: perCombatPlusOne,
  },
  {
    key: 'stillWater',
    name: '心如止水',
    usage: 'passive',
    description:
      '当你获得静心状态时，周围 15 尺内的友方单位获得 10 点临时生命值。每提升 1 级，额外获得 10 点临时生命值。',
  },
  {
    key: 'finale',
    name: '曲终',
    usage: 'perCombat',
    description:
      '消耗 2 AP 发动：当一名敌对生物的狩猎印记叠加至 4 层时，其立刻受到 6D10 点力场伤害并被晕眩，移除所有狩猎印记。每提升 1 级增加 1D8 点伤害。',
    maxUsesAtRank: perCombatPlusOne,
  },
  {
    key: 'arcaneDance',
    name: '魔能狂舞',
    usage: 'passive',
    description:
      '你可为所有攻击指定伤害类型并叠加对应状态：火焰（燃烧）、冰冻（寒冰）、毒素（中毒）、酸蚀、力场、心灵。',
  },
  // —— 影舞者 ——
  {
    key: 'galeDancer',
    name: '疾风舞者',
    usage: 'perLongRest',
    description:
      '当你将要进入负面状态而进行豁免鉴定成功后，你可以将踏风连踢的 CD -1；若踏风连踢已准备就绪，则可不消耗 AP 释放它。长休前 {uses} 次；每次升级 +1 次。',
    maxUsesAtRank: perLongRestPlusOne,
  },
  {
    key: 'takeoff',
    name: '起飞',
    usage: 'passive',
    description:
      '当你攻击一名处于击飞状态的敌人时，你可以消耗 1 点气强化旋风飞腿，额外附带 {dice}D6 点伤害。每提升 1 级增加 1D6，最多 3D6。',
    diceAtRank: diceCap3,
  },
  {
    key: 'comboFist',
    name: '连续拳',
    usage: 'passive',
    description:
      '每当你不消耗 AP 释放一个技能时，额外施加 {dice}D6 点伤害。每提升 1 级额外 +1D6。',
    diceAtRank: diceEqualsRank,
  },
  {
    key: 'multiStrike',
    name: '多重打击',
    usage: 'unlimited',
    description:
      '若本回合内对同一敌人造成 3 段或以上打击，可消耗 1 点气使其进行具有劣势的体质豁免，失败则眩晕 1 回合。',
  },
  {
    key: 'illusionDance',
    name: '迷幻舞步',
    usage: 'perLongRest',
    description:
      '消耗 1 点气在原地起舞。至多 {value} 名能看到你的敌对生物需要通过一次感知豁免，否则被你的舞步迷幻并移动至你身前 10 尺处观看，直至其下回合开始或受到伤害。该生物被魅惑期间无法闪避，豁免鉴定自动失败。每日 1 次；每次升级目标数量 +1，最多 3 个。',
    maxUsesAtRank: () => 1,
    valueAtRank: (r) => Math.min(3, r),
  },
  {
    key: 'flexibleBody',
    name: '灵活身躯',
    usage: 'unlimited',
    description:
      '消耗 1 点气，使你的闪避鉴定或敏捷豁免鉴定获得 +5 加值。每提升 1 级额外 +2。',
  },
  {
    key: 'waterWalk',
    name: '凌波微步',
    usage: 'unlimited',
    description: '消耗 1 点气发动。你可以立刻移动至多 15 尺，该移动不消耗 AP，且可以越过中型或以下体型的敌人。若你在本回合越过了任何目标，则你对该目标的下一次攻击获得优势。',
  },
  {
    key: 'heavyFist',
    name: '重拳',
    usage: 'unlimited',
    description:
      '每当你发动带有负面效果的攻击时，可消耗 1 点气将其中一名目标的敏捷豁免视为失败。升级后，你的下一次攻击获得优势。',
  },
  {
    key: 'critBlock',
    name: '重击封锁',
    usage: 'unlimited',
    description:
      '当你 10 尺范围内的一名敌对生物对另一名生物进行非魔法伤害攻击时，可消耗 1 点气代替其进行一次闪避鉴定。若成功则视为该角色成功闪避。',
  },
  {
    key: 'fateShackle',
    name: '命运枷锁',
    usage: 'unlimited',
    description:
      '你对敌对角色施加控制时，可以消耗 1 点气令其再进行一次对应属性的豁免；若豁免失败，其对应状态的层数增加 1。',
  },
  {
    key: 'showtime',
    name: '演出时间',
    usage: 'perCombat',
    description:
      '消耗 1 点气，持续 2 回合：所有可见敌对角色豁免获得劣势，你闪避时对方攻击获得劣势，你的攻击鉴定获得优势。',
    maxUsesAtRank: perCombatPlusOne,
  },
  {
    key: 'windBlade',
    name: '风刃乱舞',
    usage: 'unlimited',
    description:
      '消耗 1 点气，直至你的下回合开始前，你在回合外使用闪避不消耗 AP。',
  },
  {
    key: 'transcendentSoul',
    name: '超凡魂',
    usage: 'passive',
    description: '短休时也可回复气。每次短休最多回复气上限一半数量的气。',
  },
  // —— 废弃（迁移） ——
  {
    key: 'steadyDraw',
    name: '稳弦',
    usage: 'passive',
    deprecated: true,
    description: '（已废弃）由「残影脱身」取代。'
  },
  {
    key: 'swiftStep',
    name: '迅捷步',
    usage: 'passive',
    deprecated: true,
    description: '（已废弃）',
  },
  {
    key: 'natureWhisper',
    name: '问道自然',
    usage: 'passive',
    deprecated: true,
    description: '（已废弃）',
  },
  {
    key: 'flawObservation',
    name: '破绽观察',
    usage: 'passive',
    deprecated: true,
    description: '（已废弃）由「看破！」取代。',
  },
  {
    key: 'fatalChain',
    name: '致命连锁',
    usage: 'passive',
    deprecated: true,
    description: '（已废弃）由「重拳」取代。',
  },
  {
    key: 'calmingAura',
    name: '安定心神（旧）',
    usage: 'passive',
    deprecated: true,
    description: '（已废弃）见新版「安定心神」与「心如止水」。',
  },
  {
    key: 'lastingControl',
    name: '长效掌控',
    usage: 'passive',
    deprecated: true,
    description: '（已废弃）由「命运枷锁」取代。',
  },
]

const FEATURE_MAP = new Map(CLASS_FEATURE_DEFS.map((d) => [d.key, d]))

const ACTIVE_FEATURE_KEYS = new Set(
  CLASS_FEATURE_DEFS.filter((d) => !d.deprecated).map((d) => d.key),
)

export function getClassFeatureDef(key: ClassFeatureKey): ClassFeatureDef | undefined {
  return FEATURE_MAP.get(key)
}

export function formatFeatureDescription(def: ClassFeatureDef, featureRank: number): string {
  const uses = def.maxUsesAtRank?.(featureRank)
  const range = def.rangeAtRank?.(featureRank)
  const dice = def.diceAtRank?.(featureRank)
  const value = def.valueAtRank?.(featureRank)
  return def.description
    .replace(/\{uses\}/g, uses != null ? String(uses) : '—')
    .replace(/\{rank\}/g, String(featureRank))
    .replace(/\{range\}/g, range != null ? String(range) : '—')
    .replace(/\{dice\}/g, dice != null ? String(dice) : '—')
    .replace(/\{value\}/g, value != null ? String(value) : '—')
}

export function usageLabel(usage: TraitUsage): string {
  switch (usage) {
    case 'perCombat':
      return '每场'
    case 'perDay':
      return '每长休'
    case 'perLongRest':
      return '每长休'
    case 'passive':
      return '被动'
    default:
      return ''
  }
}

export function isBaseArcher(charClass: string): boolean {
  return charClass.includes('弓手') && charClass !== '逐风者' && charClass !== '影舞者'
}

export function isWindrunner(charClass: string): boolean {
  return charClass === '逐风者'
}

function defOf(key: ClassFeatureKey): ClassFeatureDef {
  return FEATURE_MAP.get(key)!
}

export const TRAIT_CHOICE_GROUPS: TraitChoiceGroup[] = [
  {
    id: 'archer-lv1',
    title: '弓手 · LV1 职业特性',
    hint: '请选择 1 项：双箭、穿甲箭。',
    minLevel: 1,
    pickCount: 1,
    applies: (c) => isBaseArcher(c.charClass),
    options: ['doubleArrow', 'armorPiercingArrow'].map((k) =>
      feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey)),
    ),
  },
  {
    id: 'archer-lv3',
    title: '弓手 · LV3 职业特性',
    hint: '请选择 1 项：残影脱身、鹰眼。',
    minLevel: 3,
    pickCount: 1,
    applies: (c) => isBaseArcher(c.charClass),
    options: ['stableMind', 'eagleEye'].map((k) => feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey))),
  },
  {
    id: 'archer-lv5',
    title: '弓手 · LV5 职业特性',
    hint: '请选择 1 项：精准打击、疾风连击。',
    minLevel: 5,
    pickCount: 1,
    applies: (c) => isBaseArcher(c.charClass),
    options: ['preciseStrike', 'galeCombo'].map((k) => feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey))),
  },
  {
    id: 'archer-lv8',
    title: '弓手 · LV8 职业特性',
    hint: '请选择 1 项：灵巧跳跃、荒野指引者。',
    minLevel: 8,
    pickCount: 1,
    applies: (c) => isBaseArcher(c.charClass),
    options: ['agileLeap', 'wildernessGuide'].map((k) =>
      feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey)),
    ),
  },
  {
    id: 'archer-lv12',
    title: '弓手 · LV12 职业特性',
    hint: '请选择 1 项：看破！、无声起弦。',
    minLevel: 12,
    pickCount: 1,
    applies: (c) => isBaseArcher(c.charClass),
    options: ['piercingInsight', 'silentDraw'].map((k) =>
      feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey)),
    ),
  },
  {
    id: 'windrunner-lv15',
    title: '逐风者 · LV15 职业特性',
    hint: '请选择 1 项：动物学专精、静心、魔法浪涌。',
    minLevel: 15,
    pickCount: 1,
    applies: (c) => isWindrunner(c.charClass),
    options: ['animalMastery', 'calmMind', 'arcaneSurge'].map((k) =>
      feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey)),
    ),
  },
  {
    id: 'windrunner-lv20',
    title: '逐风者 · LV20 职业特性',
    hint: '请选择 1 项：狩猎印记、魔能吞噬、安定心神。',
    minLevel: 20,
    pickCount: 1,
    applies: (c) => isWindrunner(c.charClass),
    options: ['huntingMark', 'arcaneDevour', 'calmSpirit'].map((k) =>
      feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey)),
    ),
  },
  {
    id: 'windrunner-lv25',
    title: '逐风者 · LV25 职业特性',
    hint: '请选择 1 项：追踪箭、爆裂箭矢、符文箭。',
    minLevel: 25,
    pickCount: 1,
    applies: (c) => isWindrunner(c.charClass),
    options: ['trackingArrow', 'explosiveArrow', 'runeArrow'].map((k) =>
      feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey)),
    ),
  },
  {
    id: 'windrunner-lv30',
    title: '逐风者 · LV30 职业特性',
    hint: '请选择 1 项：波澜不惊、狩猎连击、迅捷回溯。',
    minLevel: 30,
    pickCount: 1,
    applies: (c) => isWindrunner(c.charClass),
    options: ['swiftShot', 'huntingCombo', 'swiftRecall'].map((k) =>
      feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey)),
    ),
  },
  {
    id: 'windrunner-lv35',
    title: '逐风者 · LV35 职业特性',
    hint: '请选择 1 项：集中精神、影遁之术。',
    minLevel: 35,
    pickCount: 1,
    applies: (c) => isWindrunner(c.charClass),
    options: ['focusedSpirit', 'shadowVeil'].map((k) =>
      feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey)),
    ),
  },
  {
    id: 'windrunner-lv40',
    title: '逐风者 · LV40 职业特性',
    hint: '请选择 1 项：心如止水、曲终、魔能狂舞。',
    minLevel: 40,
    pickCount: 1,
    applies: (c) => isWindrunner(c.charClass),
    options: ['stillWater', 'finale', 'arcaneDance'].map((k) =>
      feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey)),
    ),
  },
  {
    id: 'shadowdancer-lv15',
    title: '影舞者 · LV15 职业特性',
    hint: '请选择 1 项：疾风舞者、起飞。',
    minLevel: 15,
    pickCount: 1,
    applies: (c) => isShadowDancer(c.charClass),
    options: ['galeDancer', 'takeoff'].map((k) => feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey))),
  },
  {
    id: 'shadowdancer-lv20',
    title: '影舞者 · LV20 职业特性',
    hint: '请选择 1 项：连续拳、多重打击。',
    minLevel: 20,
    pickCount: 1,
    applies: (c) => isShadowDancer(c.charClass),
    options: ['comboFist', 'multiStrike'].map((k) =>
      feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey)),
    ),
  },
  {
    id: 'shadowdancer-lv25',
    title: '影舞者 · LV25 职业特性',
    hint: '请选择 1 项：迷幻舞步、灵活身躯。',
    minLevel: 25,
    pickCount: 1,
    applies: (c) => isShadowDancer(c.charClass),
    options: ['illusionDance', 'flexibleBody'].map((k) =>
      feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey)),
    ),
  },
  {
    id: 'shadowdancer-lv30',
    title: '影舞者 · LV30 职业特性',
    hint: '请选择 1 项：凌波微步、重拳。',
    minLevel: 30,
    pickCount: 1,
    applies: (c) => isShadowDancer(c.charClass),
    options: ['waterWalk', 'heavyFist'].map((k) => feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey))),
  },
  {
    id: 'shadowdancer-lv35',
    title: '影舞者 · LV35 职业特性',
    hint: '请选择 1 项：重击封锁、命运枷锁，或自选特性 +1。',
    minLevel: 35,
    pickCount: 1,
    applies: (c) => isShadowDancer(c.charClass),
    options: [
      feat('critBlock', defOf('critBlock')),
      feat('fateShackle', defOf('fateShackle')),
      metaOption('featureUpgrade'),
    ],
  },
  {
    id: 'shadowdancer-lv40',
    title: '影舞者 · LV40 职业特性',
    hint: '请选择 1 项：演出时间、风刃乱舞。',
    minLevel: 40,
    pickCount: 1,
    applies: (c) => isShadowDancer(c.charClass),
    options: ['showtime', 'windBlade'].map((k) => feat(k as ClassFeatureKey, defOf(k as ClassFeatureKey))),
  },
  {
    id: 'shadowdancer-lv45',
    title: '影舞者 · LV45 里程碑',
    hint: '获得特性：超凡魂。',
    minLevel: 45,
    pickCount: 0,
    autoGrantFeatures: ['transcendentSoul'],
    applies: (c) => isShadowDancer(c.charClass),
    options: [],
  },
]

export function getTraitChoicesDone(c: Character): Record<string, boolean> {
  return c.traitChoicesDone ?? {}
}

export function isChoiceGroupDone(c: Character, groupId: string): boolean {
  if (getTraitChoicesDone(c)[groupId]) return true
  if (groupId === 'archer-lv1' && c.archerLv1ChoiceDone) return true
  if (groupId === 'archer-lv3' && c.archerLv3ChoiceDone) return true
  return false
}

export function pendingTraitChoices(c: Character): TraitChoiceGroup[] {
  if (!isArcherLineClass(c.charClass)) return []
  return TRAIT_CHOICE_GROUPS.filter(
    (g) => c.level >= g.minLevel && g.applies(c) && !isChoiceGroupDone(c, g.id),
  )
}

export function createClassTrait(key: ClassFeatureKey, _charLevel = 1): Trait {
  const def = getClassFeatureDef(key)!
  const featureRank = 1
  const maxUses = def.maxUsesAtRank?.(featureRank) ?? 0
  return {
    id: `feat-${key}`,
    name: def.name,
    level: featureRank,
    uses: maxUses,
    maxUses,
    description: formatFeatureDescription(def, featureRank),
    featureKey: key,
  }
}

export function applyTraitFeatureRank(trait: Trait, featureRank: number): Trait {
  if (!trait.featureKey) return trait
  const def = getClassFeatureDef(trait.featureKey)
  if (!def) return trait
  const cappedRank = Math.min(MAX_FEATURE_LEVEL, Math.max(1, featureRank))
  const maxUses = def.maxUsesAtRank?.(cappedRank) ?? 0
  const uses = maxUses > 0 ? Math.min(trait.uses, maxUses) : trait.uses
  return {
    ...trait,
    name: def.name,
    level: cappedRank,
    maxUses,
    uses: maxUses > trait.maxUses ? maxUses : uses,
    description: formatFeatureDescription(def, cappedRank),
  }
}

export function syncClassTraitUses(c: Character): Character {
  let traits = c.traits
  for (const def of CLASS_FEATURE_DEFS) {
    if (def.deprecated) continue
    const t = traits.find((x) => x.featureKey === def.key)
    if (!t) continue
    traits = traits.map((x) => {
      if (x.featureKey !== def.key) return x
      return applyTraitFeatureRank(x, x.level)
    })
  }
  return { ...c, traits }
}

export function isArcherLineFeatureKey(key: ClassFeatureKey | undefined): boolean {
  return !!key && ACTIVE_FEATURE_KEYS.has(key)
}

export function stripArcherLineTraits(traits: Trait[]): Trait[] {
  return traits.filter((t) => !t.featureKey || ACTIVE_FEATURE_KEYS.has(t.featureKey))
}

/** 影舞者气上限 */
export function maxQiForLevel(level: number): number {
  // TEMP: 气系统调试期间固定为 99。原公式先保留在这里，后续平衡时恢复。
  // if (level >= 50) return 6
  // if (level >= 40) return 5
  // if (level >= 30) return 4
  // if (level >= 20) return 3
  // if (level >= 15) return 2
  // return 0
  void level
  return 99
}

export function syncQiForCharacter(c: Character): Character {
  if (!isShadowDancer(c.charClass)) return { ...c, qi: undefined }
  const max = maxQiForLevel(c.level)
  const current = Number.isFinite(c.qi) ? (c.qi as number) : max
  return { ...c, qi: Math.max(0, Math.min(max, current)) }
}

export function metaChoiceLabel(key: MetaChoiceKey): string {
  return META_LABELS[key].label
}

export function metaChoiceDescription(key: MetaChoiceKey): string {
  return META_LABELS[key].description
}

const DEPRECATED_KEY_MAP: Partial<Record<ClassFeatureKey, ClassFeatureKey>> = {
  steadyDraw: 'stableMind',
  flawObservation: 'piercingInsight',
  lastingControl: 'fateShackle',
  fatalChain: 'heavyFist',
  calmingAura: 'calmSpirit',
}

export function migrateTraitKey(key: ClassFeatureKey): ClassFeatureKey {
  return DEPRECATED_KEY_MAP[key] ?? key
}

export function migrateCharacterTraits(c: Character): Character {
  const seen = new Set<ClassFeatureKey>()
  const traits: Trait[] = []
  for (const t of c.traits) {
    if (!t.featureKey) {
      traits.push(t)
      continue
    }
    const mapped = migrateTraitKey(t.featureKey)
    const def = getClassFeatureDef(mapped)
    if (!def || def.deprecated) continue
    if (seen.has(mapped)) continue
    seen.add(mapped)
    const base = t.featureKey === mapped ? t : createClassTrait(mapped, c.level)
    traits.push(
      applyTraitFeatureRank(
        { ...base, level: t.level, uses: t.uses, maxUses: t.maxUses },
        t.level,
      ),
    )
  }
  return syncClassTraitUses({ ...c, traits })
}

export function resetCombatTraitUses(c: Character): Character {
  let traits = c.traits
  for (const def of CLASS_FEATURE_DEFS) {
    if (def.deprecated || def.usage !== 'perCombat' || !def.maxUsesAtRank) continue
    traits = traits.map((t) => {
      if (t.featureKey !== def.key) return t
      const maxUses = def.maxUsesAtRank!(t.level)
      return { ...t, uses: maxUses, maxUses }
    })
  }
  return {
    ...syncQiForCharacter(c),
    traits,
    combatBuffs: {
      ...c.combatBuffs,
      doubleArrowReady: undefined,
      preciseStrikeReady: undefined,
      steadyDrawUsedThisTurn: undefined,
      silentDrawUsed: undefined,
      calmSpiritStacks: undefined,
      calmSpiritCritBonusPercent: undefined,
      calmSpiritMoveFeet: undefined,
      movedFeetThisTurn: undefined,
      tookDamageThisTurn: undefined,
      outOfBreathTurns: undefined,
      galeComboReady: undefined,
      agileLeapMoveFeet: undefined,
      freeMoveFeet: undefined,
      burstKickExtraD6: undefined,
      windKickTreatKnockbackTargetId: undefined,
      wildernessGuideBoost: undefined,
    },
  }
}
