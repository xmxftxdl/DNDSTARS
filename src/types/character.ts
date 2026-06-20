import type { AbilityKey } from '../lib/dnd'
import type { ClassFeatureKey } from '../lib/traitRegistry'
import type { CharacterEquipment } from './equipment'

export type { ClassFeatureKey } from '../lib/traitRegistry'

export type Abilities = Record<AbilityKey, number>

/** 战斗中临时增益 */
export interface CombatBuffs {
  /** 鹰眼剩余回合（己方回合开始时 -1） */
  eagleEyeTurns?: number
  /** 双箭已就绪，下次单箭射击生效 */
  doubleArrowReady?: boolean
  /** 精准打击已就绪 */
  preciseStrikeReady?: boolean
  /** 本回合已触发稳弦 */
  steadyDrawUsedThisTurn?: boolean
  /** 本场战斗已触发静默开弓 */
  silentDrawUsed?: boolean
  /** 安定心神：静心标记（上限 4） */
  calmSpiritStacks?: number
  /** 安定心神：下次攻击额外暴击率百分点 */
  calmSpiritCritBonusPercent?: number
  /** 安定心神：剩余可免费移动尺数，不触发气喘 */
  calmSpiritMoveFeet?: number
  /** 本回合移动尺数（静心判定） */
  movedFeetThisTurn?: number
  /** 本回合是否受到伤害（静心判定） */
  tookDamageThisTurn?: boolean
  /** Current combat initiative slot that has already run beginTurn. */
  turnStartKey?: string
  /** 静心状态（有静心特性且未气喘） */
  calmMind?: boolean
  calmMindFirstTurnPending?: boolean
  finaleReady?: boolean
  /** 气喘剩余回合（己方回合结束时 -1，>0 时为气喘） */
  outOfBreathTurns?: number
  /** Still Water: remaining own end turns immune to gaining out-of-breath. */
  stillWaterBreathImmunityTurns?: number
  /** Still Water: remaining own end turns before granted temporary HP expires. */
  stillWaterTempHpTurns?: number
  /** 演出时间剩余回合 */
  showtimeTurns?: number
  /** 疾风连击已就绪：下一次技能/基础射击免 AP */
  galeComboReady?: boolean
  /** 灵巧跳跃：剩余可免费移动尺数（闪避成功后） */
  agileLeapMoveFeet?: number
  /** 起身踢/安定心神等授予的临时免费移动尺数 */
  freeMoveFeet?: number
  /** 捆绑射击：本回合爆裂踢额外伤害骰数量 */
  burstKickExtraD6?: number
  /** 影遁舞步：本回合踏风连踢视为目标已击飞 */
  windKickTreatKnockbackTargetId?: string
  /** Shadow Veil: target blinded/veiled against this character for the current turn. */
  shadowVeilTargetId?: string
  /** Flexible Body: bonus applied to the next dodge or Dex save. */
  flexibleBodyBonus?: number
  /** 荒野指引者 · 特殊指引：下次生存/察觉检定具有优势 */
  wildernessGuideBoost?: boolean
}
/** 特性：有名称、等级、剩余次数、描述 */
export interface Trait {
  id: string
  name: string
  level: number
  uses: number // 当前剩余次数
  maxUses: number // 最大次数（0 表示无限/被动）
  description: string
  /** 职业预置特性（如弓手双箭） */
  featureKey?: ClassFeatureKey
}

/** 主动技能（带冷却系统） */
export interface CombatSkill {
  id: string
  name: string
  emoji: string
  description: string
  apCost: number // 行动点消耗
  cooldown: number // 基础冷却回合（1-7）
  cdReduction: number // 装备等带来的冷却减免
  remaining: number // 剩余冷却回合，0 = 待命可用
  usedThisTurn: boolean // 本回合是否已使用
  // 伤害（damageCount = 0 表示无伤害，纯辅助）
  damageCount: number // 骰子个数（如 3 个 1d4）
  damageSides: number // 骰子面数（如 d4）
  damageBonus: number // 固定加值
  /** 命中后施加的状态效果 */
  statusOnHit?: 'burning' | 'poison'
  statusDuration?: number // 状态持续回合数
  /** 命中后目标敏捷豁免对抗施法者 saveDC，失败则击飞 */
  knockbackOnHit?: boolean
  /** 击飞敏捷豁免劣势（如鹰击长空 5 阶） */
  knockbackSaveDisadvantage?: boolean
  /** 箭矢数量（1 = 单箭，可触发双箭等弓手特性） */
  arrowShots?: number
  tags?: ('ranged' | 'melee')[]
  /** 关联弓手技能树节点 id */
  skillTreeId?: string
}

export const MAX_COOLDOWN = 7

export interface BulletPuzzleState {
  /** 64 格，每格 0–6 表示子弹类型 */
  grid: number[]
  /** 7 种子弹在「准备就绪」栏中的数量 */
  ready: number[]
}

export interface Character {
  id: string
  name: string
  player: string
  avatar: string // emoji
  accent: string // tailwind 渐变色起点（用于头像底色）

  race: string
  charClass: string
  level: number
  background: string
  alignment?: string // 已弃用，保留兼容旧数据
  experience: number // 经验值
  reputation: number // 声望

  abilities: Abilities
  savingThrows: AbilityKey[] // 熟练的豁免
  skills: string[] // 熟练的技能 key

  maxHp: number
  currentHp: number
  tempHp: number
  hitDice: string

  ac: number
  speed: number
  initiativeBonus: number // 额外先攻加值（不含敏捷）

  // —— 自定义规则：战斗属性 ——
  saveDC: number // 豁免 DC
  actionPoints: number // 每回合行动点上限（默认 2）
  currentAP: number // 当前剩余行动点
  passivePerception: number // 被动感知
  inspiration: number // 激励骰数量
  mana: number // （已弃用，保留以兼容旧数据）
  maxMana: number

  traits: Trait[] // 特性
  combatSkills: CombatSkill[] // 主动技能（冷却系统）

  conditions: string[] // 状态效果
  notes: string // 玩家可见笔记

  /** 弓手 LV1 抉择是否已完成（兼容旧数据） */
  archerLv1ChoiceDone?: boolean
  /** 弓手 LV3 抉择是否已完成（兼容旧数据） */
  archerLv3ChoiceDone?: boolean
  /** 各等级特性抉择完成标记 */
  traitChoicesDone?: Record<string, boolean>
  /** 战斗中的临时增益（鹰眼等） */
  combatBuffs?: CombatBuffs

  /** 未消耗的职业特性升级点（5/10/15… 级各 +1） */
  featureUpgradePoints?: number

  /** 弓手技能树各技能当前阶位（1–5） */
  skillRanks?: Record<string, number>

  /** 影舞者 · 气 */
  qi?: number
  /** 重炮手 · 子弹消消乐（8×8 棋盘 + 就绪栏） */
  bulletPuzzle?: BulletPuzzleState

  /** 已装备物品（武器 / 护甲 / 戒指） */
  equipment?: CharacterEquipment

  // —— DM 专属 ——
  dmNotes: string // 仅 DM 可见
  visibleToPlayers: boolean // 是否对玩家公开
}

// [T5/C7] Reconciled with the actually-effective set. The first group is engine-backed
// (DOT damage, turn-skip, movement-lock, damage multiplier); 脆弱 and 无法移动 were missing
// and are now added. The second group is cosmetic-only (no engine consequence yet) and is
// kept — removing labels would orphan them on existing saved characters — but explicitly
// flagged so it's clear which conditions do something mechanically.
export const ENGINE_BACKED_CONDITIONS = [
  '燃烧', // burning DOT
  '点燃', // ignite DOT
  '中毒', // poison DOT
  '眩晕', // stun -> skips turn
  '束缚', // restrained -> movement lock
  '无法移动', // no-move -> movement lock
  '脆弱', // vulnerable -> +25% damage taken
] as const

/** Cosmetic-only — display label, no engine effect (yet). */
export const COSMETIC_CONDITIONS = [
  '恐慌',
  '魅惑',
  '目盲',
  '耳聋',
  '惊惧',
  '倒地',
  '麻痹',
  '震慑',
  '昏迷',
  '隐形',
] as const

export const CONDITION_OPTIONS = [...ENGINE_BACKED_CONDITIONS, ...COSMETIC_CONDITIONS]
