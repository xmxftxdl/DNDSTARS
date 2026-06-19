import type { CombatSkill } from '../types/character'
import type { Character } from '../types/character'

export type SkillDirection = 'basic' | 'hunt' | 'magic' | 'windrunner' | 'shadowdancer'

export const DIRECTION_LABELS: Record<SkillDirection, string> = {
  basic: '基础射击',
  hunt: '狩猎',
  magic: '魔法箭',
  windrunner: '逐风者',
  shadowdancer: '影舞者',
}

/** @deprecated 使用 DIRECTION_LABELS */
export const BRANCH_LABELS: Record<string, string> = {
  archer: '弓手',
  windrunner: '逐风者',
  shadowdancer: '影舞者',
}

export const MAX_SKILL_RANK = 5

/** 15 级前进阶为「弓手」；15 级后部分技能需「逐风者」或「影舞者」 */
export const ARCHER_SPEC_LEVEL = 15

/** 弓手技能树栏最高解锁等级（不含逐风者进阶技能） */
export const ARCHER_TREE_MAX_UNLOCK = 12

/** LV1 默认拥有，不消耗技能点 */
export const DEFAULT_SKILL_IDS = ['multiShot', 'whirlwindKick'] as const

export type SkillTreeSection = 'archer' | 'windrunner' | 'shadowdancer'

export const TREE_SECTION_LABELS: Record<SkillTreeSection, string> = {
  archer: '弓手',
  windrunner: '逐风者',
  shadowdancer: '影舞者',
}

export interface SkillPrerequisite {
  skillId: string
  minRank: number
}

export interface SkillTierStats {
  damageCount: number
  damageSides: number
  damageBonus?: number
  apCost?: number
  arrowShots?: number
  detail: string
}

export interface ArcherSkillDef {
  id: string
  name: string
  emoji: string
  direction: SkillDirection
  unlockLevel: number
  cooldown: number
  apCost: number
  tags?: ('ranged' | 'melee')[]
  range?: string
  save?: string
  effect?: string
  prerequisite?: SkillPrerequisite
  /** 仅该进阶职业可选 */
  exclusiveClass?: '逐风者' | '影舞者'
  /** 技能树分区（弓手 / 逐风者 / 影舞者各自独立一列） */
  treeSection: SkillTreeSection
  /** 分区内列（0 起） */
  treeColumn: number
  /** 分区内行（0 起，按前置链自上而下） */
  treeRow: number
  tiers: SkillTierStats[]
}

export const ARCHER_SKILL_TREE: ArcherSkillDef[] = [
  {
    id: 'multiShot',
    name: '多重射击',
    emoji: '🏹',
    direction: 'basic',
    unlockLevel: 1,
    cooldown: 3,
    apCost: 1,
    tags: ['ranged'],
    range: '30 尺内一名敌军',
    treeSection: 'archer',
    treeColumn: 0,
    treeRow: 0,
    tiers: [
      { damageCount: 1, damageSides: 4, arrowShots: 2, detail: '射出两只箭矢，每支造成 1D4 点无属性伤害。' },
      { damageCount: 2, damageSides: 4, arrowShots: 2, detail: '每支箭造成 2D4 点伤害。' },
      { damageCount: 3, damageSides: 4, arrowShots: 2, detail: '每支箭造成 3D4 点伤害。' },
      { damageCount: 4, damageSides: 4, arrowShots: 3, apCost: 2, detail: '射出三枚箭矢，每支造成 4D4 点伤害。花费 2 AP。' },
      { damageCount: 5, damageSides: 4, arrowShots: 3, apCost: 2, detail: '射出三枚箭矢，每支造成 5D4 点伤害。花费 2 AP。' },
    ],
  },
  {
    id: 'whirlwindKick',
    name: '旋风飞腿',
    emoji: '🌪️',
    direction: 'basic',
    unlockLevel: 1,
    cooldown: 2,
    apCost: 1,
    tags: ['melee'],
    range: '周围 5 尺',
    save: '敏捷豁免',
    effect: '3 阶起失败被击飞',
    treeSection: 'archer',
    treeColumn: 2,
    treeRow: 0,
    tiers: [
      { damageCount: 1, damageSides: 6, detail: '对周围 5 尺范围内的敌人发动飞腿攻击，造成 1D6 钝击伤害。' },
      { damageCount: 2, damageSides: 6, detail: '造成 2D6 点伤害。' },
      { damageCount: 2, damageSides: 6, detail: '造成 2D6 点伤害，敏捷豁免失败被击飞。' },
      { damageCount: 3, damageSides: 6, detail: '造成 3D6 点伤害，敏捷豁免失败被击飞。' },
      { damageCount: 4, damageSides: 6, detail: '造成 4D6 点伤害，敏捷豁免失败被击飞。' },
    ],
  },
  {
    id: 'clusterShot',
    name: '集束射击',
    emoji: '💥',
    direction: 'basic',
    unlockLevel: 5,
    cooldown: 3,
    apCost: 1,
    tags: ['ranged'],
    range: '10 尺内',
    effect: '10–20 尺范围内敌人伤害减半',
    prerequisite: { skillId: 'multiShot', minRank: 1 },
    treeSection: 'archer',
    treeColumn: 0,
    treeRow: 1,
    tiers: [
      { damageCount: 1, damageSides: 6, detail: '对 10 尺内敌人发射集束箭矢，造成 1D6 穿刺伤害。10–20 尺减半。' },
      { damageCount: 2, damageSides: 6, detail: '造成 2D6 点穿刺伤害。' },
      { damageCount: 3, damageSides: 6, detail: '造成 3D6 点穿刺伤害。' },
      { damageCount: 4, damageSides: 6, detail: '造成 4D6 点穿刺伤害。' },
      { damageCount: 5, damageSides: 6, detail: '造成 5D6 点穿刺伤害。' },
    ],
  },
  {
    id: 'burstKick',
    name: '爆裂踢',
    emoji: '🦵',
    direction: 'basic',
    unlockLevel: 5,
    cooldown: 2,
    apCost: 1,
    tags: ['melee'],
    range: '一名敌人',
    save: '体质豁免',
    effect: '失败眩晕 1 回合',
    prerequisite: { skillId: 'whirlwindKick', minRank: 1 },
    treeSection: 'archer',
    treeColumn: 2,
    treeRow: 1,
    tiers: [
      { damageCount: 2, damageSides: 4, detail: '对一名敌人发动近战攻击，造成 2D4 点钝击伤害。' },
      { damageCount: 3, damageSides: 4, detail: '造成 3D4 点伤害。' },
      { damageCount: 3, damageSides: 4, detail: '造成 3D4 点伤害，体质豁免失败眩晕 1 回合。' },
      { damageCount: 4, damageSides: 4, detail: '造成 4D4 点伤害，体质豁免失败眩晕 1 回合。' },
      { damageCount: 5, damageSides: 4, detail: '造成 5D4 点伤害，体质豁免失败眩晕 1 回合。' },
    ],
  },
  {
    id: 'rageShot',
    name: '怒气爆射',
    emoji: '😤',
    direction: 'hunt',
    unlockLevel: 8,
    cooldown: 3,
    apCost: 1,
    tags: ['ranged'],
    range: '60 尺内 1 名敌人',
    save: '力量豁免',
    effect: '失败则中小型生物被束缚',
    treeSection: 'archer',
    treeColumn: 1,
    treeRow: 2,
    tiers: [
      { damageCount: 1, damageSides: 6, arrowShots: 1, detail: '造成 1D6 穿刺伤害。' },
      { damageCount: 2, damageSides: 6, arrowShots: 1, detail: '造成 2D6 点伤害。' },
      { damageCount: 2, damageSides: 6, arrowShots: 1, detail: '造成 2D6 点伤害，并进行力量豁免，失败则中小型生物被束缚。' },
      { damageCount: 2, damageSides: 6, arrowShots: 2, detail: '造成 2D6 点伤害，可额外多选择一名目标，力量豁免失败则被束缚。' },
      { damageCount: 3, damageSides: 6, arrowShots: 2, detail: '造成 3D6 点伤害，可额外多选择一名目标，力量豁免失败则被束缚。' },
    ],
  },
  {
    id: 'riseKick',
    name: '起身踢',
    emoji: '⬆️',
    direction: 'basic',
    unlockLevel: 8,
    cooldown: 4,
    apCost: 1,
    tags: ['melee'],
    range: '5 尺内（倒地时）',
    effect: '造成伤害可免 AP 解除倒地；高阶可免 AP 移动',
    treeSection: 'archer',
    treeColumn: 2,
    treeRow: 2,
    tiers: [
      { damageCount: 2, damageSides: 4, detail: '倒地时对 5 尺内敌人造成 2D4 钝击伤害；若造成伤害则无需花费 AP 解除倒地。' },
      { damageCount: 3, damageSides: 4, detail: '造成 3D4 点钝击伤害。' },
      { damageCount: 4, damageSides: 4, detail: '造成 4D4 点钝击伤害。' },
      { damageCount: 4, damageSides: 4, detail: '造成 4D4 点钝击伤害，并可无需消耗 AP 移动 10 尺。' },
      { damageCount: 5, damageSides: 4, detail: '造成 5D4 点钝击伤害，并可无需消耗 AP 移动 10 尺。' },
    ],
  },
  {
    id: 'explosiveArrow',
    name: '爆裂箭',
    emoji: '🔥',
    direction: 'magic',
    unlockLevel: 12,
    cooldown: 4,
    apCost: 1,
    tags: ['ranged'],
    range: '60 尺内一名敌人',
    effect: '重击时额外火焰伤害并叠加燃烧',
    prerequisite: { skillId: 'rageShot', minRank: 1 },
    treeSection: 'archer',
    treeColumn: 1,
    treeRow: 3,
    tiers: [
      { damageCount: 1, damageSides: 6, detail: '造成 1D6 穿刺伤害；重击额外 2D6 火焰伤害并叠加一层燃烧。' },
      { damageCount: 2, damageSides: 6, detail: '造成 2D6 点伤害，重击额外 3D6 火焰伤害。' },
      { damageCount: 3, damageSides: 6, detail: '造成 3D6 点伤害，重击额外 3D6 火焰伤害。' },
      { damageCount: 4, damageSides: 6, detail: '造成 4D6 点伤害，重击额外 3D6 火焰并叠加两层燃烧。' },
      { damageCount: 5, damageSides: 6, detail: '造成 5D6 点伤害，重击额外 4D6 火焰并叠加两层燃烧。' },
    ],
  },
  {
    id: 'focusShot',
    name: '聚能射击',
    emoji: '⚡',
    direction: 'magic',
    unlockLevel: 12,
    cooldown: 3,
    apCost: 1,
    tags: ['ranged'],
    range: '5×30 方格路径',
    save: '体质豁免',
    effect: '失败眩晕一回合',
    prerequisite: { skillId: 'clusterShot', minRank: 1 },
    treeSection: 'archer',
    treeColumn: 0,
    treeRow: 2,
    tiers: [
      { damageCount: 2, damageSides: 6, detail: '路径上所有角色受到 2D6 力场伤害。' },
      { damageCount: 3, damageSides: 6, detail: '造成 3D6 点力场伤害。' },
      { damageCount: 4, damageSides: 6, detail: '造成 4D6 点力场伤害。' },
      { damageCount: 4, damageSides: 6, detail: '造成 4D6 点力场伤害，每名角色需进行体质豁免，否则眩晕一回合。' },
      { damageCount: 5, damageSides: 6, detail: '造成 5D6 点力场伤害，每名角色需进行体质豁免，否则眩晕一回合。' },
    ],
  },
  {
    id: 'aerialCombo',
    name: '飞空连击',
    emoji: '🦅',
    direction: 'windrunner',
    unlockLevel: 15,
    cooldown: 3,
    apCost: 1,
    tags: ['melee'],
    range: '20 尺内一点，10 尺半径',
    save: '敏捷豁免',
    effect: '失败受到全额伤害，成功减半',
    prerequisite: { skillId: 'clusterShot', minRank: 2 },
    exclusiveClass: '逐风者',
    treeSection: 'windrunner',
    treeColumn: 0,
    treeRow: 0,
    tiers: [
      { damageCount: 2, damageSides: 6, detail: '跳到空中，指定 20 尺内一点，对 10 尺半径圆形范围内的敌对生物进行敏捷豁免，失败受到 2D6 穿刺伤害，成功减半。' },
      { damageCount: 3, damageSides: 6, detail: '改为 3D6 点伤害。' },
      { damageCount: 4, damageSides: 6, detail: '改为 4D6 点伤害。' },
      { damageCount: 5, damageSides: 6, detail: '改为 5D6 点伤害。' },
      { damageCount: 6, damageSides: 6, detail: '改为 6D6 点伤害。' },
    ],
  },
  {
    id: 'arrowStorm',
    name: '箭雨风暴',
    emoji: '🌧️',
    direction: 'windrunner',
    unlockLevel: 15,
    cooldown: 3,
    apCost: 1,
    tags: ['ranged'],
    range: '90 尺，10×15 矩形',
    save: '敏捷豁免',
    effect: '失败受到全额伤害，成功减半',
    prerequisite: { skillId: 'clusterShot', minRank: 2 },
    exclusiveClass: '逐风者',
    treeSection: 'windrunner',
    treeColumn: 1,
    treeRow: 0,
    tiers: [
      { damageCount: 2, damageSides: 6, detail: '10×15 矩形区域，敌对生物敏捷豁免，失败受到 2D6 穿刺伤害，成功减半。' },
      { damageCount: 3, damageSides: 6, detail: '改为 3D6 点伤害。' },
      { damageCount: 4, damageSides: 6, detail: '改为 4D6 点伤害。' },
      { damageCount: 5, damageSides: 6, detail: '改为 5D6 点伤害。' },
      { damageCount: 6, damageSides: 6, detail: '改为 6D6 点伤害。' },
    ],
  },
  {
    id: 'windKickCombo',
    name: '踏风连踢',
    emoji: '💨',
    direction: 'shadowdancer',
    unlockLevel: 15,
    cooldown: 3,
    apCost: 1,
    tags: ['melee'],
    range: '移动 15 尺，终点 5 尺内',
    effect: '击飞目标额外伤害；命中后可推动',
    prerequisite: { skillId: 'whirlwindKick', minRank: 2 },
    exclusiveClass: '影舞者',
    treeSection: 'shadowdancer',
    treeColumn: 0,
    treeRow: 0,
    tiers: [
      { damageCount: 3, damageSides: 4, detail: '移动至多 15 尺，对终点 5 尺内一名敌人造成 3D4 钝击伤害；击飞状态额外 1D6；命中后可推动 5 尺。' },
      { damageCount: 4, damageSides: 4, detail: '造成 4D4 点伤害；目标击飞时额外 1D6。' },
      { damageCount: 5, damageSides: 4, detail: '造成 5D4 点伤害；目标击飞时额外 1D6；命中后可额外推动目标 5 尺。' },
      { damageCount: 5, damageSides: 4, detail: '造成 5D4 点伤害；目标击飞时额外 1D6；推动撞上障碍物额外 1D6。' },
      { damageCount: 6, damageSides: 4, detail: '造成 6D4 点伤害；目标击飞时额外 1D6，且本技能 CD -1。' },
    ],
  },
  {
    id: 'bindShot',
    name: '捆绑射击',
    emoji: '🕸️',
    direction: 'shadowdancer',
    unlockLevel: 15,
    cooldown: 3,
    apCost: 1,
    tags: ['ranged'],
    range: '20 尺内一名敌人',
    save: '力量豁免',
    effect: '小型/中型失败拉近；本回合爆裂踢 +1D6',
    prerequisite: { skillId: 'burstKick', minRank: 2 },
    exclusiveClass: '影舞者',
    treeSection: 'shadowdancer',
    treeColumn: 1,
    treeRow: 0,
    tiers: [
      { damageCount: 1, damageSides: 6, detail: '造成 1D6 伤害；小型/中型力量豁免失败拉近至多 10 尺。本回合爆裂踢伤害 +1D6。' },
      { damageCount: 2, damageSides: 6, detail: '改为 2D6 点伤害。' },
      { damageCount: 3, damageSides: 6, damageBonus: 6, detail: '改为 3D6+1D6 点伤害。' },
      { damageCount: 4, damageSides: 6, damageBonus: 6, detail: '改为 4D6+1D6 点伤害；力量豁免失败后添加缠绕效果。' },
      { damageCount: 5, damageSides: 6, damageBonus: 12, detail: '改为 5D6+2D6 点伤害；力量豁免失败后添加缠绕效果。' },
    ],
  },
  {
    id: 'refluxMagicArrow',
    name: '回流魔箭',
    emoji: '♻️',
    direction: 'windrunner',
    unlockLevel: 20,
    cooldown: 4,
    apCost: 1,
    tags: ['ranged'],
    range: '60 尺内一名敌人',
    effect: '命中后令一项冷却中技能 CD -1',
    prerequisite: { skillId: 'focusShot', minRank: 1 },
    exclusiveClass: '逐风者',
    treeSection: 'windrunner',
    treeColumn: 0,
    treeRow: 1,
    tiers: [
      { damageCount: 3, damageSides: 6, detail: '造成 3D6 点无属性魔法伤害；命中后选择一项冷却中弓箭手技能 CD -1。' },
      { damageCount: 4, damageSides: 6, detail: '造成 4D6 点无属性魔法伤害。' },
      { damageCount: 4, damageSides: 6, detail: '造成 4D6 点伤害；重击时选择一项技能 CD 额外 -1。' },
      { damageCount: 5, damageSides: 6, detail: '造成 5D6 点伤害；重击时选择一项技能 CD 额外 -1。' },
      { damageCount: 6, damageSides: 6, detail: '造成 6D6 点伤害；重击时选择一项技能 CD 额外 -1。' },
    ],
  },
  {
    id: 'encircle',
    name: '包围',
    emoji: '⭕',
    direction: 'windrunner',
    unlockLevel: 20,
    cooldown: 4,
    apCost: 1,
    tags: ['ranged'],
    range: '原地',
    effect: '一回合内无法移动',
    prerequisite: { skillId: 'arrowStorm', minRank: 1 },
    exclusiveClass: '逐风者',
    treeSection: 'windrunner',
    treeColumn: 1,
    treeRow: 1,
    tiers: [
      { damageCount: 2, damageSides: 6, arrowShots: 3, detail: '射出 3 支强力箭矢，每支 2D6 穿刺伤害。一回合内无法移动。' },
      { damageCount: 2, damageSides: 6, damageBonus: 1, arrowShots: 3, detail: '每支箭伤害提升为 2D6+1。' },
      { damageCount: 2, damageSides: 6, arrowShots: 4, detail: '射出 4 支箭；至少 3 支命中同一目标则其移速 -10 尺，持续 1 回合。' },
      { damageCount: 2, damageSides: 6, damageBonus: 2, arrowShots: 4, detail: '每支箭 2D6+2；若处于气喘状态，使用后获得静心状态。' },
      { damageCount: 2, damageSides: 6, arrowShots: 5, detail: '射出 5 支箭；全部射向同一目标则体质豁免失败眩晕 1 回合。' },
    ],
  },
  {
    id: 'spiralBlade',
    name: '螺旋刀刃',
    emoji: '🌀',
    direction: 'shadowdancer',
    unlockLevel: 20,
    cooldown: 4,
    apCost: 1,
    tags: ['melee'],
    range: '5 尺半径圆形',
    save: '敏捷豁免',
    effect: '失败受到伤害',
    prerequisite: { skillId: 'bindShot', minRank: 1 },
    exclusiveClass: '影舞者',
    treeSection: 'shadowdancer',
    treeColumn: 1,
    treeRow: 1,
    tiers: [
      { damageCount: 2, damageSides: 6, detail: '5 尺半径内敌对生物敏捷豁免，失败受到 2D6 点伤害。' },
      { damageCount: 3, damageSides: 6, detail: '改为 3D6 点伤害。' },
      { damageCount: 4, damageSides: 6, detail: '改为 4D6 点伤害。' },
      { damageCount: 5, damageSides: 6, detail: '改为 5D6 点伤害。' },
      { damageCount: 6, damageSides: 6, detail: '改为 6D6 点伤害。' },
    ],
  },
  {
    id: 'shadowDance',
    name: '影遁舞步',
    emoji: '👤',
    direction: 'shadowdancer',
    unlockLevel: 20,
    cooldown: 4,
    apCost: 1,
    tags: ['melee'],
    range: '移动 15 尺，从敌人下方穿过',
    effect: '不触发借机攻击；本回合踏风连踢视为击飞',
    prerequisite: { skillId: 'windKickCombo', minRank: 1 },
    exclusiveClass: '影舞者',
    treeSection: 'shadowdancer',
    treeColumn: 0,
    treeRow: 1,
    tiers: [
      { damageCount: 2, damageSides: 6, detail: '移动至多 15 尺从一名敌人下方穿过，造成 2D6 钝击伤害。不触发借机攻击。' },
      { damageCount: 3, damageSides: 6, detail: '改为 3D6 点钝击伤害。' },
      { damageCount: 3, damageSides: 6, detail: '3D6 点伤害；本回合若可施展踏风连踢，该目标视为拥有击飞状态。' },
      { damageCount: 4, damageSides: 6, detail: '4D6 点伤害；本回合踏风连踢视为击飞状态。' },
      { damageCount: 5, damageSides: 6, detail: '5D6 点钝击伤害；本回合踏风连踢视为击飞状态。' },
    ],
  },
  {
    id: 'windTraceShot',
    name: '风痕贯射',
    emoji: '🌬️',
    direction: 'windrunner',
    unlockLevel: 25,
    cooldown: 4,
    apCost: 1,
    tags: ['ranged'],
    range: '5 尺 × 60 尺直线',
    effect: '路径上仅一名敌人时额外 +2D6',
    prerequisite: { skillId: 'encircle', minRank: 1 },
    exclusiveClass: '逐风者',
    treeSection: 'windrunner',
    treeColumn: 1,
    treeRow: 2,
    tiers: [
      { damageCount: 5, damageSides: 6, detail: '直线路径上所有敌对生物受到 5D6 穿刺伤害；仅一名敌人时额外 2D6。' },
      { damageCount: 6, damageSides: 6, detail: '6D6 点伤害；静心状态下额外 +1D6。' },
      { damageCount: 6, damageSides: 6, detail: '6D6 点伤害；目标带有狩猎印记时每层印记 +1D6。' },
      { damageCount: 7, damageSides: 6, detail: '7D6 点伤害；静心状态下本技能使用后 CD -1。' },
      { damageCount: 7, damageSides: 6, detail: '7D6 点伤害；只命中一名带狩猎印记敌人时本次攻击具有优势，若命中则造成重击。' },
    ],
  },
  {
    id: 'antiMagicArrow',
    name: '破魔箭',
    emoji: '🔮',
    direction: 'windrunner',
    unlockLevel: 25,
    cooldown: 4,
    apCost: 1,
    tags: ['ranged'],
    range: '90 尺内一名敌人',
    effect: '目标有魔法增益时额外 2D6；高阶移除增益',
    prerequisite: { skillId: 'refluxMagicArrow', minRank: 1 },
    exclusiveClass: '逐风者',
    treeSection: 'windrunner',
    treeColumn: 0,
    treeRow: 2,
    tiers: [
      { damageCount: 5, damageSides: 6, detail: '造成 5D6 无属性魔法伤害；目标有持续性增益或魔法状态时额外 2D6。' },
      { damageCount: 6, damageSides: 6, detail: '造成 6D6 点伤害。' },
      { damageCount: 6, damageSides: 6, detail: '6D6 点伤害；给予脆弱状态，物防/魔防 1 回合内 -25%。' },
      { damageCount: 7, damageSides: 6, detail: '7D6 点伤害；取消目标所有增益效果。' },
      { damageCount: 7, damageSides: 6, detail: '7D6 点伤害；每移除一个魔法增益，本技能 CD -1。' },
    ],
  },
  {
    id: 'shadowStepShot',
    name: '影步穿射',
    emoji: '🌑',
    direction: 'shadowdancer',
    unlockLevel: 25,
    cooldown: 4,
    apCost: 1,
    tags: ['ranged'],
    range: '移动 10 尺 + 60 尺射击',
    effect: '移动不触发借机；远距离视为优势',
    prerequisite: { skillId: 'spiralBlade', minRank: 1 },
    exclusiveClass: '影舞者',
    treeSection: 'shadowdancer',
    treeColumn: 1,
    treeRow: 2,
    tiers: [
      { damageCount: 4, damageSides: 6, detail: '移动至多 10 尺后对 60 尺内一名敌人射出一箭，造成 4D6 穿刺伤害。不触发借机攻击。' },
      { damageCount: 5, damageSides: 6, detail: '造成 5D6 点穿刺伤害。' },
      { damageCount: 6, damageSides: 6, detail: '造成 6D6 点穿刺伤害。' },
      { damageCount: 6, damageSides: 6, detail: '6D6 点伤害；移动距离提升至 15 尺。' },
      { damageCount: 6, damageSides: 6, detail: '6D6 点伤害；移动后与目标距离不小于 30 尺则本次攻击视为具有优势。' },
    ],
  },
  {
    id: 'eagleStrike',
    name: '鹰击长空',
    emoji: '🦅',
    direction: 'shadowdancer',
    unlockLevel: 25,
    cooldown: 4,
    apCost: 1,
    tags: ['melee'],
    range: '5 尺内一名生物',
    effect: '三段腿法 + 击飞；攻击击飞状态敌人 CD 减少',
    prerequisite: { skillId: 'shadowDance', minRank: 1 },
    exclusiveClass: '影舞者',
    treeSection: 'shadowdancer',
    treeColumn: 0,
    treeRow: 2,
    tiers: [
      { damageCount: 3, damageSides: 4, detail: '连续 3 段腿法攻击，总计 3D4 点钝击伤害；击飞时额外 3D6 点钝击伤害。若目标已处于击飞状态，则本技能 CD -2。' },
      { damageCount: 3, damageSides: 4, detail: '连续 3 段腿法攻击，总计 3D4+4D6 点钝击伤害。' },
      { damageCount: 3, damageSides: 6, detail: '连续 3 段腿法攻击，总计 3D6+4D6 点钝击伤害。' },
      { damageCount: 3, damageSides: 6, detail: '连续 3 段腿法攻击，总计 3D6+4D6 点钝击伤害；攻击击飞状态的敌人时，本技能 CD -3。' },
      { damageCount: 3, damageSides: 6, detail: '连续 3 段腿法攻击，总计 3D6+4D6 点钝击伤害；攻击击飞状态的敌人时，本技能 CD -3，该生物击飞时的敏捷豁免鉴定获得劣势。' },
    ],
  },
]

/** 基础射击：不在技能树中升级，战斗默认拥有 */
export const BASIC_SHOT_DEF: ArcherSkillDef = {
  id: 'basicShot',
  name: '基础射击',
  emoji: '🎯',
  direction: 'basic',
  unlockLevel: 1,
  cooldown: 0,
  apCost: 1,
  tags: ['ranged'],
  range: '远程',
  treeSection: 'archer',
  treeColumn: 0,
  treeRow: -1,
  tiers: [
    { damageCount: 1, damageSides: 8, arrowShots: 1, detail: '造成 1D8 点穿刺伤害。无冷却，随时可用。' },
    { damageCount: 1, damageSides: 8, arrowShots: 1, detail: '造成 1D8 点穿刺伤害。' },
    { damageCount: 1, damageSides: 8, arrowShots: 1, detail: '造成 1D8 点穿刺伤害。' },
    { damageCount: 1, damageSides: 8, arrowShots: 1, detail: '造成 1D8 点穿刺伤害。' },
    { damageCount: 1, damageSides: 8, arrowShots: 1, detail: '造成 1D8 点穿刺伤害。' },
  ],
}

const SKILL_MAP = new Map([...ARCHER_SKILL_TREE, BASIC_SHOT_DEF].map((s) => [s.id, s]))

export function getArcherSkillDef(id: string): ArcherSkillDef | undefined {
  return SKILL_MAP.get(id)
}

export function isArcherLineClass(charClass: string): boolean {
  return charClass.includes('弓手') || charClass === '逐风者' || charClass === '影舞者'
}

export function isDefaultSkill(skillId: string): boolean {
  return (DEFAULT_SKILL_IDS as readonly string[]).includes(skillId)
}

/** 按角色等级累计应获得的技能点（每 5 级 +2） */
export function skillPointsEarned(charLevel: number): number {
  return Math.floor(charLevel / 5) * 2
}

export function skillPointsGrantedOnLevelUp(oldLevel: number, newLevel: number): number {
  if (newLevel <= oldLevel) return 0
  return skillPointsEarned(newLevel) - skillPointsEarned(oldLevel)
}

const SKILL_RANK_UNLOCK_LEVELS: Record<number, [number, number, number, number, number]> = {
  1: [1, 5, 10, 15, 20],
  5: [5, 10, 15, 20, 25],
  8: [8, 15, 20, 25, 30],
  12: [12, 20, 25, 30, 35],
  15: [15, 20, 25, 30, 35],
  20: [20, 25, 30, 35, 40],
  25: [25, 30, 35, 40, 45],
}

export function skillRankCapForCharacterLevel(charLevel: number, skillUnlockLevel: number): number {
  const unlocks = SKILL_RANK_UNLOCK_LEVELS[skillUnlockLevel] ?? [skillUnlockLevel, skillUnlockLevel + 5, skillUnlockLevel + 10, skillUnlockLevel + 15, skillUnlockLevel + 20]
  let cap = 0
  for (let i = 0; i < unlocks.length; i += 1) {
    if (charLevel >= unlocks[i]) cap = i + 1
  }
  return Math.min(MAX_SKILL_RANK, cap)
}

/** 已消耗的技能点（不含默认技能 1 阶） */
export function skillPointsSpent(c: Character): number {
  let spent = 0
  for (const [skillId, rank] of Object.entries(c.skillRanks ?? {})) {
    if (isDefaultSkill(skillId)) {
      spent += Math.max(0, rank - 1)
    } else {
      spent += rank
    }
  }
  return spent
}

export function getAvailableSkillPoints(c: Character): number {
  return Math.max(0, skillPointsEarned(c.level) - skillPointsSpent(c))
}

export function isSkillClassAllowed(c: Character, def: ArcherSkillDef): boolean {
  if (!isArcherLineClass(c.charClass)) return false
  if (def.exclusiveClass && c.charClass !== def.exclusiveClass) return false
  // LV15 前非专属技能：弓手系均可学
  if (def.unlockLevel < ARCHER_SPEC_LEVEL) return true
  if (def.exclusiveClass) return c.charClass === def.exclusiveClass
  if (def.direction === 'windrunner') return c.charClass === '逐风者'
  if (def.direction === 'shadowdancer') return c.charClass === '影舞者'
  return true
}

/** LV15+ 技能所需的进阶职业；无则表示弓手系均可 */
export function getSkillClassRequirement(def: ArcherSkillDef): '逐风者' | '影舞者' | null {
  if (def.exclusiveClass) return def.exclusiveClass
  if (def.unlockLevel < ARCHER_SPEC_LEVEL) return null
  if (def.direction === 'windrunner') return '逐风者'
  if (def.direction === 'shadowdancer') return '影舞者'
  return null
}

export function meetsSkillPrerequisite(c: Character, def: ArcherSkillDef): boolean {
  if (!def.prerequisite) return true
  return getSkillRank(c, def.prerequisite.skillId) >= def.prerequisite.minRank
}

export function isSkillLearned(c: Character, skillId: string): boolean {
  if (isDefaultSkill(skillId) && isArcherLineClass(c.charClass)) return true
  return (c.skillRanks?.[skillId] ?? 0) > 0
}

export function getSkillRank(c: Character, skillId: string): number {
  const stored = c.skillRanks?.[skillId]
  if (stored != null && stored > 0) return Math.min(MAX_SKILL_RANK, stored)
  if (isDefaultSkill(skillId) && isArcherLineClass(c.charClass)) return 1
  return 0
}

export function isArcherSkillUnlocked(c: Character, def: ArcherSkillDef): boolean {
  if (def.id === 'basicShot') return isArcherLineClass(c.charClass)
  if (!isArcherLineClass(c.charClass)) return false
  if (!isSkillClassAllowed(c, def)) return false
  if (c.level < def.unlockLevel) return false
  if (!meetsSkillPrerequisite(c, def)) return false
  return isSkillLearned(c, def.id)
}

export function canLearnSkill(c: Character, skillId: string): boolean {
  const def = getArcherSkillDef(skillId)
  if (!def || def.id === 'basicShot' || isSkillLearned(c, skillId)) return false
  if (!isArcherLineClass(c.charClass)) return false
  if (!isSkillClassAllowed(c, def)) return false
  if (c.level < def.unlockLevel) return false
  if (!meetsSkillPrerequisite(c, def)) return false
  return getAvailableSkillPoints(c) >= 1
}

export function canUpgradeSkillRank(c: Character, skillId: string): boolean {
  const def = getArcherSkillDef(skillId)
  if (!def || def.id === 'basicShot') return false
  if (!isSkillLearned(c, skillId)) return false
  if (!isSkillClassAllowed(c, def)) return false
  if (getSkillRank(c, skillId) >= MAX_SKILL_RANK) return false
  if (getSkillRank(c, skillId) >= skillRankCapForCharacterLevel(c.level, def.unlockLevel)) return false
  return getAvailableSkillPoints(c) >= 1
}

export function formatSkillDamage(tier: SkillTierStats): string {
  if (tier.damageCount <= 0) return '—'
  const bonus = tier.damageBonus ? (tier.damageBonus > 0 ? `+${tier.damageBonus}` : String(tier.damageBonus)) : ''
  return `${tier.damageCount}D${tier.damageSides}${bonus}`
}

type SkillDisplayMeta = {
  range?: string
  target?: string | ((rank: number) => string)
  damageType?: string
  damage?: (rank: number, tier: SkillTierStats) => string | undefined
  save?: string | ((rank: number) => string | undefined)
  effect?: string | ((rank: number) => string | undefined)
}

const SKILL_DISPLAY_META: Record<string, SkillDisplayMeta> = {
  basicShot: {
    range: '90 尺',
    target: '单体',
    damageType: '穿刺',
    effect: '无冷却，随时可用。',
  },
  multiShot: {
    range: '30 尺',
    target: (rank) => (rank >= 4 ? '至多三名敌人' : '至多两名敌人'),
    damageType: '无属性',
    damage: (rank, tier) => `每支箭 ${formatSkillDamage(tier)} 点无属性伤害`,
    effect: (rank) => (rank >= 4 ? '射出三支箭矢，可分别选择目标。' : '射出两支箭矢，可分别选择目标。'),
  },
  whirlwindKick: {
    range: '周围 5 尺',
    target: '范围内敌对生物',
    damageType: '钝击',
    save: '敏捷豁免',
    effect: '成功伤害减半；失败受到全额伤害并被击飞。',
  },
  clusterShot: {
    range: '20 尺',
    target: '单体',
    damageType: '穿刺',
    effect: '10 尺内全额伤害；10-20 尺伤害减半。',
  },
  burstKick: {
    range: '5 尺',
    target: '单体',
    damageType: '钝击',
    save: (rank) => (rank >= 3 ? '体质豁免' : undefined),
    effect: (rank) => (rank >= 3 ? '失败眩晕 1 回合。' : undefined),
  },
  rageShot: {
    range: '60 尺',
    target: (rank) => (rank >= 4 ? '至多两名敌人' : '单体'),
    damageType: '穿刺',
    save: (rank) => (rank >= 3 ? '力量豁免' : undefined),
    effect: (rank) => {
      if (rank >= 4) return '可额外选择一名目标；中型或更小目标豁免失败则被束缚。'
      if (rank >= 3) return '中型或更小目标豁免失败则被束缚。'
      return undefined
    },
  },
  riseKick: {
    range: '5 尺',
    target: '单体',
    damageType: '钝击',
    effect: (rank) =>
      rank >= 4
        ? '仅倒地时可用；造成伤害后免费解除倒地，并可免费移动 10 尺。'
        : '仅倒地时可用；造成伤害后免费解除倒地。',
  },
  explosiveArrow: {
    range: '60 尺',
    target: '单体',
    damageType: '魔法',
    effect: (rank) =>
      rank >= 4
        ? '重击时额外造成火焰伤害并叠加 2 层燃烧。'
        : '重击时额外造成火焰伤害并叠加 1 层燃烧。',
  },
  focusShot: {
    range: '5×30 尺直线路径',
    target: '路径覆盖的敌对生物',
    damageType: '力场',
    save: '敏捷豁免',
    effect: '失败伤害减半。',
  },
  aerialCombo: {
    range: '20 尺内一点，10 尺半径',
    target: '圆形范围内敌对生物',
    damageType: '穿刺',
    save: '敏捷豁免',
    effect: '失败受到全额伤害；成功伤害减半。',
  },
  arrowStorm: {
    range: '90 尺，10×15 尺矩形',
    target: '矩形范围内敌对生物',
    damageType: '穿刺',
    save: '敏捷豁免',
    effect: '失败受到全额伤害；成功伤害减半。可按 Q/E 旋转矩形方向。',
  },
  windKickCombo: {
    range: '移动 15 尺，终点 5 尺内',
    target: '单体',
    damageType: '钝击',
    damage: (rank) => {
      const dice = rank >= 5 ? '6D4' : rank >= 3 ? '5D4' : rank >= 2 ? '4D4' : '3D4'
      return `${dice} 点钝击伤害`
    },
    effect: (rank) => {
      const parts = ['目标处于击飞状态时额外造成 1D6 点钝击伤害。']
      if (rank >= 3) parts.push('命中后可额外推动目标 5 尺。')
      if (rank >= 4) parts.push('推动撞上障碍物时额外造成 1D6 点钝击伤害。')
      if (rank >= 5) parts.push('攻击击飞状态的目标时，本技能 CD -1。')
      return parts.join('')
    },
  },
  bindShot: {
    range: '20 尺',
    target: '单体',
    damageType: '穿刺',
    damage: (rank, tier) => {
      if (rank >= 5) return '5D6+2D6 点穿刺伤害'
      if (rank >= 4) return '4D6+1D6 点穿刺伤害'
      if (rank >= 3) return '3D6+1D6 点穿刺伤害'
      return `${formatSkillDamage(tier)} 点穿刺伤害`
    },
    save: '力量豁免',
    effect: (rank) =>
      rank >= 4
        ? '小型/中型目标失败则被拉近并缠绕；本回合爆裂踢伤害 +1D6。'
        : '小型/中型目标失败则被拉近至多 10 尺；本回合爆裂踢伤害 +1D6。',
  },
  refluxMagicArrow: {
    range: '60 尺',
    target: '单体',
    damageType: '无属性魔法',
    effect: (rank) =>
      rank >= 3
        ? '命中后选择一项冷却中技能 CD -1；重击时额外再 CD -1。'
        : '命中后选择一项冷却中技能 CD -1。',
  },
  encircle: {
    range: '原地',
    target: '箭矢指定目标',
    damageType: '穿刺',
    damage: (rank, tier) => `每支箭 ${formatSkillDamage(tier)} 点穿刺伤害`,
    save: (rank) => (rank >= 5 ? '体质豁免' : undefined),
    effect: (rank) => {
      if (rank >= 5) return '射出 5 支箭；全部射向同一目标时，目标豁免失败则眩晕 1 回合。'
      if (rank >= 4) return '射出 4 支箭；若自身处于气喘状态，使用后获得静心状态。'
      if (rank >= 3) return '射出 4 支箭；至少 3 支命中同一目标时，该目标速度 -10 尺，持续 1 回合。'
      return '射出 3 支箭；命中目标一回合内无法移动。'
    },
  },
  spiralBlade: {
    range: '5 尺半径圆形',
    target: '范围内敌对生物',
    damageType: '斩击',
    save: '敏捷豁免',
    effect: '失败受到伤害；成功无伤害。',
  },
  shadowDance: {
    range: '移动 15 尺，从敌人下方穿过',
    target: '单体',
    damageType: '钝击',
    effect: (rank) =>
      rank >= 3
        ? '移动不触发借机攻击；本回合该目标对踏风连踢视为处于击飞状态。'
        : '移动不触发借机攻击。',
  },
  windTraceShot: {
    range: '5×60 尺直线',
    target: '路径覆盖的敌对生物',
    damageType: '穿刺',
    effect: (rank) => {
      if (rank >= 5) return '若只命中一名带狩猎印记的敌人，本次攻击具有优势；若命中则造成重击。'
      if (rank >= 4) return '静心状态下使用后，本技能 CD -1。'
      if (rank >= 3) return '目标带有狩猎印记时，每层印记额外 +1D6。'
      if (rank >= 2) return '静心状态下额外 +1D6。'
      return '路径上仅有一名敌人时额外 +2D6。'
    },
  },
  antiMagicArrow: {
    range: '90 尺',
    target: '单体',
    damageType: '无属性魔法',
    effect: (rank) => {
      if (rank >= 5) return '目标有魔法增益或状态时额外 +2D6；每移除一个魔法增益，本技能 CD -1。'
      if (rank >= 4) return '目标有魔法增益或状态时额外 +2D6；取消目标所有增益效果。'
      if (rank >= 3) return '目标有魔法增益或状态时额外 +2D6；给予脆弱状态。'
      return '目标有魔法增益或状态时额外 +2D6。'
    },
  },
  shadowStepShot: {
    range: '移动 10 尺 + 60 尺射击',
    target: '单体',
    damageType: '穿刺',
    effect: (rank) =>
      rank >= 5
        ? '移动不触发借机攻击；移动后与目标距离不小于 30 尺时，本次攻击具有优势。'
        : rank >= 4
          ? '移动距离提升至 15 尺；移动不触发借机攻击。'
          : '移动不触发借机攻击。',
  },
  eagleStrike: {
    range: '5 尺',
    target: '单体',
    damageType: '钝击',
    damage: (rank) => {
      if (rank >= 3) return '3D6+4D6 点钝击伤害'
      if (rank >= 2) return '3D4+4D6 点钝击伤害'
      return '3D4+3D6 点钝击伤害'
    },
    save: (rank) => (rank >= 5 ? '敏捷豁免（击飞，劣势）' : '敏捷豁免（击飞）'),
    effect: (rank) => {
      if (rank >= 5) return '连续 3 段腿法攻击；攻击击飞状态的敌人时，本技能 CD -3，且目标击飞豁免劣势。'
      if (rank >= 4) return '连续 3 段腿法攻击；攻击击飞状态的敌人时，本技能 CD -3。'
      return '连续 3 段腿法攻击；若目标已处于击飞状态，本技能 CD -2。'
    },
  },
}

function resolveDisplayValue(value: string | ((rank: number) => string | undefined) | undefined, rank: number) {
  return typeof value === 'function' ? value(rank) : value
}

function displayTarget(def: ArcherSkillDef, rank: number): string {
  const metaTarget = resolveDisplayValue(SKILL_DISPLAY_META[def.id]?.target, rank)
  if (metaTarget) return metaTarget
  if (def.tags?.includes('ranged') || def.tags?.includes('melee')) return '单体'
  return '目标'
}

function displayDamage(def: ArcherSkillDef, rank: number, tier: SkillTierStats): string | undefined {
  const meta = SKILL_DISPLAY_META[def.id]
  const custom = meta?.damage?.(rank, tier)
  if (custom) return custom
  const damage = formatSkillDamage(tier)
  if (damage === '—') return undefined
  const type = meta?.damageType
  return type ? `${damage} 点${type}伤害` : `${damage} 点伤害`
}

export function buildSkillTierDescription(def: ArcherSkillDef, rank: number): string {
  const safeRank = Math.max(1, Math.min(MAX_SKILL_RANK, rank))
  const tier = def.tiers[safeRank - 1] ?? def.tiers[0]
  const meta = SKILL_DISPLAY_META[def.id]
  const range = meta?.range ?? def.range
  const target = displayTarget(def, safeRank)
  const damage = displayDamage(def, safeRank, tier)
  const save = meta && 'save' in meta ? resolveDisplayValue(meta.save, safeRank) : def.save
  const effect = meta && 'effect' in meta ? resolveDisplayValue(meta.effect, safeRank) : def.effect
  const parts = [
    range && `范围：${range}`,
    target && `目标：${target}`,
    damage && `伤害：${damage}`,
    save && `豁免：${save}`,
    effect && `效果：${effect}`,
  ].filter(Boolean)
  return parts.join('。')
}

/** 该技能树节点在指定阶数是否附带击飞（敏捷豁免失败） */
export function skillGrantsKnockback(skillTreeId: string, rank: number): boolean {
  if (skillTreeId === 'whirlwindKick') return rank >= 1
  if (skillTreeId === 'eagleStrike') return rank >= 1
  return false
}

/** 该技能树节点在指定阶数是否附带眩晕（体质豁免失败） */
export function skillGrantsStun(skillTreeId: string, rank: number): boolean {
  if (skillTreeId === 'burstKick') return rank >= 3
  if (skillTreeId === 'focusShot') return rank >= 4
  return false
}

export function skillKnockbackSaveDisadvantage(skillTreeId: string, rank: number): boolean {
  return skillTreeId === 'eagleStrike' && rank >= 5
}

export function buildSkillDescription(def: ArcherSkillDef, rank: number): string {
  return buildSkillTierDescription(def, rank)
}

export function skillToCombatSkill(
  def: ArcherSkillDef,
  rank: number,
  existing?: CombatSkill,
): CombatSkill {
  const tier = def.tiers[Math.max(0, rank - 1)] ?? def.tiers[0]
  const apCost = tier.apCost ?? def.apCost
  return {
    id: existing?.id ?? `tree-${def.id}`,
    name: def.name,
    emoji: def.emoji,
    description: buildSkillDescription(def, rank),
    apCost,
    cooldown: def.cooldown,
    cdReduction: existing?.cdReduction ?? 0,
    remaining: existing?.remaining ?? 0,
    usedThisTurn: existing?.usedThisTurn ?? false,
    damageCount: tier.damageCount,
    damageSides: tier.damageSides,
    damageBonus: tier.damageBonus ?? 0,
    arrowShots: tier.arrowShots,
    tags: def.tags,
    skillTreeId: def.id,
    statusOnHit: def.id === 'explosiveArrow' ? 'burning' : existing?.statusOnHit,
    statusDuration: def.id === 'explosiveArrow' ? 3 : existing?.statusDuration,
    knockbackOnHit: skillGrantsKnockback(def.id, rank),
    knockbackSaveDisadvantage: skillKnockbackSaveDisadvantage(def.id, rank),
  }
}

export function learnedSkillsForCharacter(c: Character): ArcherSkillDef[] {
  return ARCHER_SKILL_TREE.filter((def) => isSkillLearned(c, def.id) && isSkillClassAllowed(c, def))
}

/** @deprecated 使用 learnedSkillsForCharacter */
export function skillsForCharacter(c: Character): ArcherSkillDef[] {
  return learnedSkillsForCharacter(c)
}

export function isBaseArcherClass(charClass: string): boolean {
  return charClass === '弓手'
}

/** 技能树三栏：弓手（≤12 级）/ 逐风者 / 影舞者 */
export type SkillTreeDisplaySection = 'archer' | 'windrunner' | 'shadowdancer'

export function skillTreeDisplaySection(def: ArcherSkillDef): SkillTreeDisplaySection {
  if (def.treeSection === 'shadowdancer') return 'shadowdancer'
  if (def.treeSection === 'windrunner') return 'windrunner'
  return 'archer'
}

/** 技能树中是否展示该节点 */
export function isSkillVisibleInTree(c: Character, def: ArcherSkillDef): boolean {
  if (!isArcherLineClass(c.charClass)) return false

  if (def.treeSection === 'shadowdancer' || def.treeSection === 'windrunner') {
    return isSkillClassAllowed(c, def)
  }

  if (def.treeSection === 'archer') {
    return def.unlockLevel <= ARCHER_TREE_MAX_UNLOCK
  }

  return false
}

export function visibleSkillsInTree(c: Character): ArcherSkillDef[] {
  return ARCHER_SKILL_TREE.filter((def) => isSkillVisibleInTree(c, def)).sort((a, b) => {
    if (a.treeSection !== b.treeSection) return a.treeSection.localeCompare(b.treeSection)
    if (a.treeRow !== b.treeRow) return a.treeRow - b.treeRow
    if (a.treeColumn !== b.treeColumn) return a.treeColumn - b.treeColumn
    return a.unlockLevel - b.unlockLevel
  })
}

/** 按技能树三栏（弓手 / 逐风者 / 影舞者）归类可见技能 */
export function visibleSkillsByDisplaySection(
  c: Character,
): Record<SkillTreeDisplaySection, ArcherSkillDef[]> {
  const buckets: Record<SkillTreeDisplaySection, ArcherSkillDef[]> = {
    archer: [],
    windrunner: [],
    shadowdancer: [],
  }
  for (const def of visibleSkillsInTree(c)) {
    buckets[skillTreeDisplaySection(def)].push(def)
  }
  return buckets
}

const ALL_SKILL_TREE_SECTIONS: SkillTreeDisplaySection[] = ['archer', 'windrunner', 'shadowdancer']

/** 技能树全部栏位（固定顺序） */
export function skillTreeDisplaySections(): SkillTreeDisplaySection[] {
  return ALL_SKILL_TREE_SECTIONS
}

/** 当前角色有可见技能的栏位（不展示空栏） */
export function visibleSkillTreeDisplaySections(c: Character): SkillTreeDisplaySection[] {
  const bySection = visibleSkillsByDisplaySection(c)
  return ALL_SKILL_TREE_SECTIONS.filter((section) => bySection[section].length > 0)
}

export function skillTreeDisplaySectionLabel(section: SkillTreeDisplaySection): string {
  return TREE_SECTION_LABELS[section]
}

/** 前置是否在同一展示分区内（可画连线）；跨栏前置（如弓手→逐风者）不连线 */
export function isIntraPanelPrerequisite(def: ArcherSkillDef): boolean {
  if (!def.prerequisite) return false
  const parent = getArcherSkillDef(def.prerequisite.skillId)
  if (!parent) return false
  return skillTreeDisplaySection(parent) === skillTreeDisplaySection(def)
}

export function getPrerequisiteLabel(def: ArcherSkillDef): string | null {
  if (!def.prerequisite) return null
  const parent = getArcherSkillDef(def.prerequisite.skillId)
  if (!parent) return null
  return `${parent.name} ${def.prerequisite.minRank} 级`
}
