import type { AbilityKey } from './dnd'
import { GOBLIN_EQUIPMENT, HOBGOBLIN_EQUIPMENT } from './equipmentDefaults'
import type { CharacterEquipment } from '../types/equipment'

export interface MonsterTrait {
  name: string
  description: string
}

export interface MonsterAction {
  name: string
  description: string
  /** [T6/B2] 机读攻击命中加值（如 弯刀 +4） */
  toHit?: number
  /** [T6/B2] 机读伤害骰（如 '1d6+2'、'2d8'） */
  damageDice?: string
  /** [T6/B2] 伤害类型（如 'slashing'、'piercing'、'poison'） */
  damageType?: string
  /** [T6/B2] 触及/射程（尺） */
  range?: number
  /** [T6/B2] 攻击形态：近战 / 远程 / 范围（吐息等） */
  kind?: 'melee' | 'ranged' | 'aoe'
  /** [T6/B2] 范围攻击的豁免（吐息），T7 消费 */
  save?: { ability: AbilityKey; dc: number }
}

export interface MonsterSkillNote {
  name: string
  bonus: string
}

export interface EnemyStatBlock {
  cr: string
  ac: number
  /** [T6/B9/B10] HP 真相源：与 ENEMY_POOL 模板一致（parity 测试守护）。 */
  maxHp: number
  speed: string
  abilities: Record<AbilityKey, number>
  /** 装备栏（启用派生战斗数值） */
  equipment?: CharacterEquipment
  skills?: MonsterSkillNote[]
  senses?: string
  languages?: string
  traits: MonsterTrait[]
  actions: MonsterAction[]
}

/** 据 DND 标准属性（8到20）映射为本应用属性分值（25到79，调整 ±0） */
export function dndAbility(standard: number): number {
  const mod = Math.floor((standard - 10) / 2)
  return 25 + mod * 5
}

const A = dndAbility

export const ENEMY_STAT_BLOCKS: Record<string, EnemyStatBlock> = {
  goblin: {
    cr: '1/4',
    ac: 14,
    maxHp: 12,
    speed: '30 尺',
    abilities: { str: A(8), dex: A(14), con: A(10), int: A(10), wis: A(8), cha: A(8) },
    equipment: { ...GOBLIN_EQUIPMENT },
    skills: [{ name: '隐匿', bonus: '+6' }],
    senses: '黑暗视觉 60 尺',
    languages: '通用语、哥布林语',
    traits: [
      {
        name: '迅捷逃脱',
        description: '哥布林可在自己的每个回合用附赠动作执行撤离或躲藏动作。',
      },
    ],
    actions: [
      {
        name: '弯刀',
        description: '近战武器攻击：命中 +4，触及 5 尺，单一目标。命中：5（1d6 + 2）挥砍伤害。',
        toHit: 4,
        damageDice: '1d6+2',
        damageType: 'slashing',
        range: 5,
        kind: 'melee',
      },
      {
        name: '短弓',
        description: '远程武器攻击：命中 +4，射程 80/320 尺，单一目标。命中：5（1d6 + 2）穿刺伤害。',
        toHit: 4,
        damageDice: '1d6+2',
        damageType: 'piercing',
        range: 80,
        kind: 'ranged',
      },
    ],
  },
  hobgoblin: {
    cr: '1/2',
    ac: 18,
    maxHp: 22,
    speed: '30 尺',
    abilities: { str: A(13), dex: A(12), con: A(12), int: A(10), wis: A(10), cha: A(9) },
    equipment: { ...HOBGOBLIN_EQUIPMENT },
    senses: '黑暗视觉 60 尺',
    languages: '通用语、哥布林语',
    traits: [
      {
        name: '军事纪律',
        description: '30 尺内若有未失能的友方大地精，该大地精对攻击检定与豁免具有优势。',
      },
    ],
    actions: [
      {
        name: '长剑',
        description: '近战武器攻击：命中 +3，触及 5 尺。命中：5（1d8 + 1）挥砍伤害，或使用双手时 6（1d10 + 1）。',
        toHit: 3,
        damageDice: '1d8+1',
        damageType: 'slashing',
        range: 5,
        kind: 'melee',
      },
      {
        name: '长弓',
        description: '远程武器攻击：命中 +3，射程 150/600 尺。命中：5（1d8 + 1）穿刺伤害。',
        toHit: 3,
        damageDice: '1d8+1',
        damageType: 'piercing',
        range: 150,
        kind: 'ranged',
      },
    ],
  },
  orc: {
    cr: '1/2',
    ac: 13,
    maxHp: 30,
    speed: '30 尺',
    abilities: { str: A(16), dex: A(12), con: A(16), int: A(7), wis: A(11), cha: A(10) },
    skills: [{ name: '威吓', bonus: '+2' }],
    senses: '黑暗视觉 60 尺',
    languages: '通用语、兽人语',
    traits: [
      {
        name: '凶恶攻击',
        description: '近战武器命中时，可额外造成 4（1d8）点伤害（每短休或长休一次）。',
      },
    ],
    actions: [
      {
        name: '巨斧',
        description: '近战武器攻击：命中 +5，触及 5 尺。命中：9（1d12 + 3）挥砍伤害。',
        toHit: 5,
        damageDice: '1d12+3',
        damageType: 'slashing',
        range: 5,
        kind: 'melee',
      },
      {
        name: '标枪',
        description: '远程武器攻击：命中 +5，射程 30/120 尺。命中：6（1d6 + 3）穿刺伤害。',
        toHit: 5,
        damageDice: '1d6+3',
        damageType: 'piercing',
        range: 30,
        kind: 'ranged',
      },
    ],
  },
  bugbear: {
    cr: '1',
    ac: 16,
    maxHp: 45,
    speed: '30 尺',
    abilities: { str: A(17), dex: A(14), con: A(14), int: A(11), wis: A(12), cha: A(11) },
    skills: [
      { name: '隐匿', bonus: '+6' },
      { name: '生存', bonus: '+2' },
    ],
    senses: '黑暗视觉 60 尺',
    languages: '通用语、哥布林语',
    traits: [
      {
        name: '伏击者',
        description: '若在第一轮战斗中先于目标行动，对该目标的攻击检定具有优势。',
      },
      {
        name: '蛮力突袭',
        description: '近战攻击命中时，额外造成 7（2d6）点伤害（每回合一次）。',
      },
    ],
    actions: [
      {
        name: '晨星',
        description: '近战武器攻击：命中 +4，触及 5 尺。命中：11（2d8 + 3）穿刺伤害。',
        toHit: 4,
        damageDice: '2d8+3',
        damageType: 'piercing',
        range: 5,
        kind: 'melee',
      },
      {
        name: '标枪',
        description: '远程武器攻击：命中 +4，射程 30/120 尺。命中：5（1d6 + 3）穿刺伤害。',
        toHit: 4,
        damageDice: '1d6+3',
        damageType: 'piercing',
        range: 30,
        kind: 'ranged',
      },
    ],
  },
  skeleton: {
    cr: '1/4',
    ac: 13,
    maxHp: 18,
    speed: '30 尺',
    abilities: { str: A(10), dex: A(14), con: A(15), int: A(6), wis: A(8), cha: A(5) },
    senses: '黑暗视觉 60 尺',
    languages: '理解通用语等，但不会说',
    traits: [
      {
        name: '易伤',
        description: '受钝击伤害时易伤。',
      },
    ],
    actions: [
      {
        name: '短剑',
        description: '近战武器攻击：命中 +4，触及 5 尺。命中：5（1d6 + 2）穿刺伤害。',
        toHit: 4,
        damageDice: '1d6+2',
        damageType: 'piercing',
        range: 5,
        kind: 'melee',
      },
      {
        name: '短弓',
        description: '远程武器攻击：命中 +4，射程 80/320 尺。命中：5（1d6 + 2）穿刺伤害。',
        toHit: 4,
        damageDice: '1d6+2',
        damageType: 'piercing',
        range: 80,
        kind: 'ranged',
      },
    ],
  },
  zombie: {
    cr: '1/4',
    ac: 8,
    maxHp: 28,
    speed: '20 尺',
    abilities: { str: A(13), dex: A(6), con: A(16), int: A(3), wis: A(6), cha: A(5) },
    senses: '黑暗视觉 60 尺',
    languages: '理解通用语等，但不会说',
    traits: [
      {
        name: '不死坚韧',
        description: '受非光耀、非重击伤害降至 0 生命时，可进行 CON 豁免（DC 5 + 所受伤害），成功则改为 1 生命（每长休一次）。',
      },
    ],
    actions: [
      {
        name: '猛击',
        description: '近战武器攻击：命中 +3，触及 5 尺。命中：4（1d6 + 1）钝击伤害。',
        toHit: 3,
        damageDice: '1d6+1',
        damageType: 'bludgeoning',
        range: 5,
        kind: 'melee',
      },
    ],
  },
  ghoul: {
    cr: '1',
    ac: 12,
    maxHp: 26,
    speed: '30 尺',
    abilities: { str: A(13), dex: A(15), con: A(10), int: A(7), wis: A(10), cha: A(6) },
    senses: '黑暗视觉 60 尺',
    languages: '通用语',
    traits: [
      {
        name: '亡灵本质',
        description: '免疫毒素伤害；魅惑、力竭、中毒状态。',
      },
    ],
    actions: [
      {
        name: '爪击',
        description: '近战武器攻击：命中 +4，触及 5 尺。命中：7（2d4 + 2）挥砍伤害；目标须通过 DC 10 体质豁免，否则麻痹 1 分钟。',
        toHit: 4,
        damageDice: '2d4+2',
        damageType: 'slashing',
        range: 5,
        kind: 'melee',
      },
      {
        name: '啃咬',
        description: '近战武器攻击：命中 +2，触及 5 尺（仅对麻痹、束缚或无意识目标）。命中：9（2d6 + 2）穿刺伤害。',
        toHit: 2,
        damageDice: '2d6+2',
        damageType: 'piercing',
        range: 5,
        kind: 'melee',
      },
    ],
  },
  wolf: {
    cr: '1/4',
    ac: 13,
    maxHp: 16,
    speed: '40 尺',
    abilities: { str: A(12), dex: A(15), con: A(12), int: A(3), wis: A(12), cha: A(6) },
    skills: [
      { name: '察觉', bonus: '+3' },
      { name: '隐匿', bonus: '+4' },
    ],
    senses: '被动察觉 13',
    traits: [
      {
        name: '集群战术',
        description: '若 5 尺内有未失能的友方，对目标的攻击检定具有优势。',
      },
      {
        name: '敏锐嗅听觉',
        description: '察觉依赖嗅觉或听觉的检定具有优势。',
      },
    ],
    actions: [
      {
        name: '啃咬',
        description: '近战武器攻击：命中 +4，触及 5 尺。命中：7（2d4 + 1）穿刺伤害；目标须通过 DC 11 力量豁免，否则倒地。',
        toHit: 4,
        damageDice: '2d4+1',
        damageType: 'piercing',
        range: 5,
        kind: 'melee',
      },
    ],
  },
  'dire-wolf': {
    cr: '1',
    ac: 14,
    maxHp: 37,
    speed: '50 尺',
    abilities: { str: A(17), dex: A(15), con: A(15), int: A(3), wis: A(12), cha: A(7) },
    skills: [
      { name: '察觉', bonus: '+3' },
      { name: '隐匿', bonus: '+4' },
    ],
    traits: [
      {
        name: '集群战术',
        description: '若 5 尺内有未失能的友方，对目标的攻击检定具有优势。',
      },
    ],
    actions: [
      {
        name: '啃咬',
        description: '近战武器攻击：命中 +5，触及 5 尺。命中：10（2d6 + 3）穿刺伤害；目标须通过 DC 13 力量豁免，否则倒地。',
        toHit: 5,
        damageDice: '2d6+3',
        damageType: 'piercing',
        range: 5,
        kind: 'melee',
      },
    ],
  },
  'brown-bear': {
    cr: '1',
    ac: 11,
    maxHp: 42,
    speed: '40 尺，攀爬 30 尺',
    abilities: { str: A(19), dex: A(10), con: A(16), int: A(2), wis: A(13), cha: A(7) },
    skills: [{ name: '察觉', bonus: '+3' }],
    senses: '被动察觉 13',
    traits: [
      {
        name: '敏锐嗅听觉',
        description: '察觉依赖嗅觉或听觉的检定具有优势。',
      },
    ],
    actions: [
      {
        name: '多重攻击',
        description: '进行两次攻击：一次啃咬，一次爪击。',
      },
      {
        name: '啃咬',
        description: '近战武器攻击：命中 +6，触及 5 尺。命中：8（1d8 + 4）穿刺伤害。',
        toHit: 6,
        damageDice: '1d8+4',
        damageType: 'piercing',
        range: 5,
        kind: 'melee',
      },
      {
        name: '爪击',
        description: '近战武器攻击：命中 +6，触及 5 尺。命中：11（2d6 + 4）挥砍伤害。',
        toHit: 6,
        damageDice: '2d6+4',
        damageType: 'slashing',
        range: 5,
        kind: 'melee',
      },
    ],
  },
  'giant-spider': {
    cr: '1',
    ac: 14,
    maxHp: 26,
    speed: '30 尺，攀爬 30 尺',
    abilities: { str: A(14), dex: A(16), con: A(12), int: A(2), wis: A(11), cha: A(4) },
    skills: [{ name: '隐匿', bonus: '+7' }],
    senses: '盲视 10 尺，黑暗视觉 60 尺',
    traits: [
      {
        name: '蛛行',
        description: '可沿任意表面攀爬，包括倒吊天花板，无需检定。',
      },
      {
        name: '网缚感知',
        description: '感知网中生物的精确位置。',
      },
    ],
    actions: [
      {
        name: '啃咬',
        description: '近战武器攻击：命中 +5，触及 5 尺。命中：7（1d8 + 3）穿刺伤害，外加 9（2d8）毒素伤害（DC 11 体质减半）。',
        toHit: 5,
        damageDice: '1d8+3',
        damageType: 'piercing',
        range: 5,
        kind: 'melee',
      },
      {
        name: '吐网',
        description: '远程武器攻击：命中 +5，射程 30/60 尺。命中：目标束缚（DC 12 力量或敏捷豁免挣脱）。',
        toHit: 5,
        range: 30,
        kind: 'ranged',
      },
    ],
  },
  slime: {
    cr: '1/2',
    ac: 8,
    maxHp: 22,
    speed: '20 尺，攀爬 20 尺',
    abilities: { str: A(10), dex: A(5), con: A(16), int: A(1), wis: A(6), cha: A(2) },
    senses: '盲视 60 尺（盲视外失明）',
    traits: [
      {
        name: '无定形',
        description: '可挤入 1 寸宽缝隙；无需额外动作即可通过 1 寸空间。',
      },
      {
        name: '分裂',
        description: '受钝击、闪电或挥砍伤害且生命值≤0 时，分裂为两个较小史莱姆（各半生命）。',
      },
    ],
    actions: [
      {
        name: '伪足',
        description: '近战武器攻击：命中 +3，触及 5 尺。命中：4（1d6 + 1）钝击伤害，外加 7（2d6）强酸伤害。',
        toHit: 3,
        damageDice: '1d6+1',
        damageType: 'bludgeoning',
        range: 5,
        kind: 'melee',
      },
    ],
  },
  bandit: {
    cr: '1/8',
    ac: 12,
    maxHp: 16,
    speed: '30 尺',
    abilities: { str: A(11), dex: A(12), con: A(12), int: A(10), wis: A(10), cha: A(10) },
    languages: '通用语',
    actions: [
      {
        name: '弯刀',
        description: '近战武器攻击：命中 +3，触及 5 尺。命中：4（1d6 + 1）挥砍伤害。',
        toHit: 3,
        damageDice: '1d6+1',
        damageType: 'slashing',
        range: 5,
        kind: 'melee',
      },
      {
        name: '轻弩',
        description: '远程武器攻击：命中 +3，射程 80/320 尺。命中：5（1d8 + 1）穿刺伤害。',
        toHit: 3,
        damageDice: '1d8+1',
        damageType: 'piercing',
        range: 80,
        kind: 'ranged',
      },
    ],
    traits: [],
  },
  guard: {
    cr: '1/8',
    ac: 16,
    maxHp: 24,
    speed: '30 尺',
    abilities: { str: A(13), dex: A(12), con: A(12), int: A(10), wis: A(11), cha: A(10) },
    skills: [{ name: '察觉', bonus: '+2' }],
    languages: '通用语',
    actions: [
      {
        name: '矛',
        description: '近战或远程武器攻击：命中 +3，触及 5 尺或射程 20/60 尺。命中：4（1d6 + 1）穿刺或 5（1d8 + 1）。',
        toHit: 3,
        damageDice: '1d6+1',
        damageType: 'piercing',
        range: 5,
        kind: 'melee',
      },
    ],
    traits: [],
  },
  cultist: {
    cr: '1/8',
    ac: 12,
    maxHp: 14,
    speed: '30 尺',
    abilities: { str: A(11), dex: A(10), con: A(10), int: A(10), wis: A(11), cha: A(10) },
    skills: [{ name: '欺瞒', bonus: '+2' }, { name: '宗教', bonus: '+2' }],
    languages: '通用语',
    traits: [
      {
        name: '黑暗虔诚',
        description: '对魅惑或恐慌的豁免具有优势。',
      },
    ],
    actions: [
      {
        name: '弯刀',
        description: '近战武器攻击：命中 +3，触及 5 尺。命中：4（1d6 + 1）挥砍伤害。',
        toHit: 3,
        damageDice: '1d6+1',
        damageType: 'slashing',
        range: 5,
        kind: 'melee',
      },
    ],
  },
  'mage-apprentice': {
    cr: '1/4',
    ac: 11,
    maxHp: 18,
    speed: '30 尺',
    abilities: { str: A(9), dex: A(12), con: A(10), int: A(14), wis: A(11), cha: A(11) },
    skills: [{ name: '奥秘', bonus: '+4' }, { name: '历史', bonus: '+4' }],
    languages: '通用语',
    traits: [
      {
        name: '施法',
        description: '智力为施法属性（法术豁免 DC 12，法术攻击 +4）。已知：法师之手、光亮术、魔法飞弹（3 发）、护盾术。',
      },
    ],
    actions: [
      {
        name: '匕首',
        description: '近战或远程武器攻击：命中 +3，触及 5 尺或射程 20/60 尺。命中：3（1d4 + 1）穿刺伤害。',
        toHit: 3,
        damageDice: '1d4+1',
        damageType: 'piercing',
        range: 5,
        kind: 'melee',
      },
    ],
  },
  ogre: {
    cr: '2',
    ac: 11,
    maxHp: 59,
    speed: '40 尺',
    abilities: { str: A(19), dex: A(8), con: A(16), int: A(5), wis: A(7), cha: A(7) },
    senses: '黑暗视觉 60 尺',
    languages: '通用语、巨人语',
    actions: [
      {
        name: '巨棒',
        description: '近战武器攻击：命中 +6，触及 5 尺。命中：13（2d8 + 4）钝击伤害。',
        toHit: 6,
        damageDice: '2d8+4',
        damageType: 'bludgeoning',
        range: 5,
        kind: 'melee',
      },
      {
        name: '标枪',
        description: '远程武器攻击：命中 +6，射程 30/120 尺。命中：11（2d6 + 4）穿刺伤害。',
        toHit: 6,
        damageDice: '2d6+4',
        damageType: 'piercing',
        range: 30,
        kind: 'ranged',
      },
    ],
    traits: [],
  },
  troll: {
    cr: '5',
    ac: 15,
    maxHp: 84,
    speed: '30 尺',
    abilities: { str: A(18), dex: A(13), con: A(20), int: A(7), wis: A(9), cha: A(7) },
    skills: [{ name: '察觉', bonus: '+2' }],
    senses: '黑暗视觉 60 尺',
    languages: '巨人语',
    traits: [
      {
        name: '再生',
        description: '回合开始时恢复 10 生命；仅受强酸或火焰伤害时该回合再生失效；生命为 0 且未受上述伤害时仍死亡。',
      },
      {
        name: '敏锐嗅听觉',
        description: '察觉依赖嗅觉或听觉的检定具有优势。',
      },
    ],
    actions: [
      {
        name: '多重攻击',
        description: '一次啃咬与两次爪击。',
      },
      {
        name: '啃咬',
        description: '近战武器攻击：命中 +7，触及 5 尺。命中：7（1d6 + 4）穿刺伤害。',
        toHit: 7,
        damageDice: '1d6+4',
        damageType: 'piercing',
        range: 5,
        kind: 'melee',
      },
      {
        name: '爪击',
        description: '近战武器攻击：命中 +7，触及 5 尺。命中：11（2d6 + 4）挥砍伤害。',
        toHit: 7,
        damageDice: '2d6+4',
        damageType: 'slashing',
        range: 5,
        kind: 'melee',
      },
    ],
  },
  owlbear: {
    cr: '3',
    ac: 13,
    maxHp: 59,
    speed: '40 尺',
    abilities: { str: A(20), dex: A(12), con: A(17), int: A(3), wis: A(12), cha: A(7) },
    skills: [{ name: '察觉', bonus: '+3' }],
    senses: '黑暗视觉 60 尺',
    traits: [
      {
        name: '敏锐嗅听觉',
        description: '察觉依赖嗅觉或听觉的检定具有优势。',
      },
    ],
    actions: [
      {
        name: '多重攻击',
        description: '一次喙击与一次爪击。',
      },
      {
        name: '喙击',
        description: '近战武器攻击：命中 +7，触及 5 尺。命中：10（1d10 + 5）穿刺伤害。',
        toHit: 7,
        damageDice: '1d10+5',
        damageType: 'piercing',
        range: 5,
        kind: 'melee',
      },
      {
        name: '爪击',
        description: '近战武器攻击：命中 +7，触及 5 尺。命中：14（2d8 + 5）挥砍伤害。',
        toHit: 7,
        damageDice: '2d8+5',
        damageType: 'slashing',
        range: 5,
        kind: 'melee',
      },
    ],
  },
  harpy: {
    cr: '1',
    ac: 11,
    maxHp: 38,
    speed: '20 尺，飞行 40 尺',
    abilities: { str: A(12), dex: A(13), con: A(12), int: A(7), wis: A(10), cha: A(13) },
    senses: '黑暗视觉 60 尺',
    languages: '通用语',
    traits: [
      {
        name: '诱惑之歌',
        description: '启动需 1 动作，10 尺内听见者须通过 DC 11 感知豁免，否则被魅惑并走向鹰身女妖（直至受伤或歌曲结束）。',
      },
    ],
    actions: [
      {
        name: '爪击（爪）',
        description: '近战武器攻击：命中 +3，触及 5 尺。命中：6（2d4 + 1）挥砍伤害。',
        toHit: 3,
        damageDice: '2d4+1',
        damageType: 'slashing',
        range: 5,
        kind: 'melee',
      },
    ],
  },
  'wyrmling-red': {
    cr: '4',
    ac: 17,
    maxHp: 52,
    speed: '30 尺，攀爬 30 尺，飞行 60 尺',
    abilities: { str: A(17), dex: A(10), con: A(15), int: A(12), wis: A(11), cha: A(15) },
    skills: [{ name: '察觉', bonus: '+4' }, { name: '隐匿', bonus: '+2' }],
    senses: '盲视 10 尺，黑暗视觉 60 尺',
    languages: '龙语',
    traits: [
      {
        name: '火焰抗性',
        description: '对火焰伤害具有抗性。',
      },
    ],
    actions: [
      {
        name: '啃咬',
        description: '近战武器攻击：命中 +5，触及 5 尺。命中：1D10+3 穿刺伤害，外加 1D6 火焰伤害。',
        toHit: 5,
        damageDice: '1d10+3',
        damageType: 'piercing',
        range: 5,
        kind: 'melee',
      },
      {
        name: '火焰吐息',
        description: '15 尺锥形区域，区域内生物进行 DC12 敏捷豁免，失败受到 4D6 火焰伤害，成功减半。测试用 AI：第一回合默认优先使用。',
        damageDice: '4d6',
        damageType: 'fire',
        range: 15,
        kind: 'aoe',
        save: { ability: 'dex', dc: 12 },
      },
    ],
  },
  'wyrmling-green': {
    cr: '2',
    ac: 17,
    maxHp: 48,
    speed: '30 尺，飞行 60 尺，游泳 30 尺',
    abilities: { str: A(15), dex: A(12), con: A(13), int: A(14), wis: A(11), cha: A(13) },
    skills: [{ name: '察觉', bonus: '+4' }, { name: '欺瞒', bonus: '+4' }, { name: '隐匿', bonus: '+4' }],
    senses: '盲视 10 尺，黑暗视觉 60 尺',
    languages: '龙语',
    traits: [
      {
        name: '水陆两栖',
        description: '可在空气与水中呼吸。',
      },
    ],
    actions: [
      {
        name: '啃咬',
        description: '近战武器攻击：命中 +4，触及 5 尺。命中：7（1d10 + 2）穿刺伤害，外加 3（1d6）毒素伤害。',
        toHit: 4,
        damageDice: '1d10+2',
        damageType: 'piercing',
        range: 5,
        kind: 'melee',
      },
      {
        name: '毒气吐息',
        description: '15 尺锥形区域，DC 11 体质豁免，失败 21（6d6）毒素伤害，成功减半（充能 5–6）。',
        damageDice: '6d6',
        damageType: 'poison',
        range: 15,
        kind: 'aoe',
        save: { ability: 'con', dc: 11 },
      },
    ],
  },
  imp: {
    cr: '1',
    ac: 13,
    maxHp: 14,
    speed: '20 尺，飞行 40 尺',
    abilities: { str: A(6), dex: A(17), con: A(13), int: A(11), wis: A(12), cha: A(14) },
    skills: [{ name: '欺瞒', bonus: '+4' }, { name: '洞悉', bonus: '+3' }, { name: '隐匿', bonus: '+4' }],
    senses: '黑暗视觉 120 尺',
    languages: '炼狱语、通用语',
    traits: [
      {
        name: '魔法抗性',
        description: '对抗法术与其他魔法效应的豁免具有优势。',
      },
      {
        name: '隐形',
        description: '附赠动作隐形，直至攻击、施法或结束专注。',
      },
    ],
    actions: [
      {
        name: '钉刺',
        description: '近战武器攻击：命中 +5，触及 5 尺。命中：5（1d4 + 3）穿刺伤害，外加 10（3d6）毒素伤害。',
        toHit: 5,
        damageDice: '1d4+3',
        damageType: 'piercing',
        range: 5,
        kind: 'melee',
      },
    ],
  },
  'animated-armor': {
    cr: '1',
    ac: 18,
    maxHp: 33,
    speed: '25 尺',
    abilities: { str: A(14), dex: A(11), con: A(13), int: A(1), wis: A(3), cha: A(1) },
    senses: '盲视 60 尺（盲视外失明）',
    traits: [
      {
        name: '反魔法易伤',
        description: '处于反魔法场中陷入失能；对解除魔法的豁免自动失败。',
      },
    ],
    actions: [
      {
        name: '猛击',
        description: '近战武器攻击：命中 +4，触及 5 尺。命中：5（1d6 + 2）钝击伤害。',
        toHit: 4,
        damageDice: '1d6+2',
        damageType: 'bludgeoning',
        range: 5,
        kind: 'melee',
      },
    ],
  },
  gargoyle: {
    cr: '2',
    ac: 15,
    maxHp: 52,
    speed: '30 尺，飞行 60 尺',
    abilities: { str: A(15), dex: A(11), con: A(16), int: A(6), wis: A(11), cha: A(7) },
    skills: [{ name: '隐匿', bonus: '+4' }],
    senses: '黑暗视觉 60 尺',
    languages: '土族语',
    traits: [
      {
        name: '拟形',
        description: '静止时可与石质表面融为一体，察觉检定需对抗 DC 15 才能发现。',
      },
    ],
    actions: [
      {
        name: '多重攻击',
        description: '一次啃咬、一次爪击、一对触角顶撞（若数据简化则合并为爪击）。',
      },
      {
        name: '啃咬',
        description: '近战武器攻击：命中 +4，触及 5 尺。命中：5（1d6 + 2）穿刺伤害。',
        toHit: 4,
        damageDice: '1d6+2',
        damageType: 'piercing',
        range: 5,
        kind: 'melee',
      },
      {
        name: '爪击',
        description: '近战武器攻击：命中 +4，触及 5 尺。命中：5（1d6 + 2）挥砍伤害。',
        toHit: 4,
        damageDice: '1d6+2',
        damageType: 'slashing',
        range: 5,
        kind: 'melee',
      },
    ],
  },
}

export function getEnemyStatBlock(id: string): EnemyStatBlock | undefined {
  return ENEMY_STAT_BLOCKS[id]
}

/**
 * [T6/B1/B2] 主攻击动作：用于派生战斗数值与（T7 起）AI 攻击。
 * 选取规则：优先含 damageDice 的近战动作；无近战则取首个含 damageDice 的非范围动作；
 * 都没有时回退到首个带 damageDice 的动作（理论上不应发生）。
 * 范围吐息（kind:'aoe'）不作为「主攻击」（由 T7 的专门分支驱动）。
 */
export function getPrimaryAttackAction(block: EnemyStatBlock): MonsterAction | undefined {
  const withDice = block.actions.filter((a) => !!a.damageDice)
  return (
    withDice.find((a) => a.kind === 'melee') ??
    withDice.find((a) => a.kind !== 'aoe') ??
    withDice[0]
  )
}
