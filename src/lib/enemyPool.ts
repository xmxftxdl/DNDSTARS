import { enemyHasDerivedCombat, getEnemyMaxHp } from './enemyCombatStats'
import {
  creatureSizeToTokenSize,
  inferCreatureSizeFromTags,
  inferCreatureTypesFromTags,
  type CreatureSize,
  type CreatureType,
} from './monsterTypes'

/** 怪物池模板（用于 DM 快速放置敌人 token） */
export interface EnemyTemplate {
  id: string
  name: string
  emoji: string
  color: string
  maxHp: number
  /** 默认等于 maxHp */
  hp?: number
  size?: number
  creatureTypes?: CreatureType[]
  creatureSize?: CreatureSize
  tags: string[]
  description?: string
}

export const ENEMY_POOL: EnemyTemplate[] = [
  {
    id: 'goblin',
    name: '哥布林',
    emoji: '👺',
    color: '#4ade80',
    maxHp: 12,
    tags: ['类人生物', '小型', '哥布林'],
    description: '敏捷的小型类人生物，常成群出现。',
  },
  {
    id: 'hobgoblin',
    name: '大地精',
    emoji: '🪖',
    color: '#f87171',
    maxHp: 22,
    tags: ['类人生物', '中型', '哥布林'],
    description: '纪律严明、好战的类人生物。',
  },
  {
    id: 'orc',
    name: '兽人',
    emoji: '👹',
    color: '#ef4444',
    maxHp: 30,
    size: 1.25,
    tags: ['类人生物', '中型', '兽人'],
    description: '强壮好战的战士。',
  },
  {
    id: 'bugbear',
    name: '熊地精',
    emoji: '🐻',
    color: '#b45309',
    maxHp: 45,
    size: 1.5,
    tags: ['类人生物', '大型', '哥布林'],
    description: '潜行伏击的大型类人生物。',
  },
  {
    id: 'skeleton',
    name: '骷髅',
    emoji: '💀',
    color: '#e2e8f0',
    maxHp: 18,
    tags: ['亡灵', '中型', '不死'],
    description: '由魔法驱动的骸骨战士。',
  },
  {
    id: 'zombie',
    name: '僵尸',
    emoji: '🧟',
    color: '#84cc16',
    maxHp: 28,
    tags: ['亡灵', '中型', '不死'],
    description: '行动迟缓但耐打的亡灵。',
  },
  {
    id: 'ghoul',
    name: '食尸鬼',
    emoji: '🧟‍♂️',
    color: '#a3e635',
    maxHp: 26,
    tags: ['亡灵', '中型', '不死'],
    description: '爪击可麻痹目标的亡灵。',
  },
  {
    id: 'wolf',
    name: '狼',
    emoji: '🐺',
    color: '#94a3b8',
    maxHp: 16,
    tags: ['野兽', '中型', '动物'],
    description: '常见的群居掠食者。',
  },
  {
    id: 'dire-wolf',
    name: '恐狼',
    emoji: '🐺',
    color: '#64748b',
    maxHp: 37,
    size: 1.25,
    tags: ['野兽', '大型', '动物'],
    description: '体型巨大的狼，咬合力惊人。',
  },
  {
    id: 'brown-bear',
    name: '棕熊',
    emoji: '🐻',
    color: '#92400e',
    maxHp: 42,
    size: 1.5,
    tags: ['野兽', '大型', '动物'],
    description: '力大无穷的森林猛兽。',
  },
  {
    id: 'giant-spider',
    name: '巨型蜘蛛',
    emoji: '🕷️',
    color: '#1e293b',
    maxHp: 26,
    tags: ['野兽', '大型', '蛛形'],
    description: '可吐丝束缚猎物的巨蛛。',
  },
  {
    id: 'slime',
    name: '史莱姆',
    emoji: '🫧',
    color: '#38bdf8',
    maxHp: 22,
    tags: ['泥浆', '大型', '元素'],
    description: '酸性凝胶状怪物，分裂后可增殖。',
  },
  {
    id: 'bandit',
    name: '强盗',
    emoji: '🗡️',
    color: '#78716c',
    maxHp: 16,
    tags: ['类人生物', '中型', '人类'],
    description: '拦路抢劫的亡命徒。',
  },
  {
    id: 'guard',
    name: '守卫',
    emoji: '🛡️',
    color: '#6366f1',
    maxHp: 24,
    tags: ['类人生物', '中型', '人类'],
    description: '着甲的城镇或要塞卫兵。',
  },
  {
    id: 'cultist',
    name: '邪教徒',
    emoji: '🕯️',
    color: '#7c3aed',
    maxHp: 14,
    tags: ['类人生物', '中型', '人类'],
    description: '崇拜黑暗存在的狂热者。',
  },
  {
    id: 'mage-apprentice',
    name: '法师学徒',
    emoji: '🧙',
    color: '#818cf8',
    maxHp: 18,
    tags: ['类人生物', '中型', '施法者'],
    description: '掌握基础法术的学徒法师。',
  },
  {
    id: 'ogre',
    name: '食人魔',
    emoji: '🧌',
    color: '#ea580c',
    maxHp: 59,
    size: 2,
    tags: ['巨人', '大型', '蛮力'],
    description: '愚笨但破坏力极强的大型怪物。',
  },
  {
    id: 'troll',
    name: '巨魔',
    emoji: '👾',
    color: '#16a34a',
    maxHp: 84,
    size: 2,
    tags: ['巨人', '大型', '再生'],
    description: '拥有再生能力的绿皮巨人。',
  },
  {
    id: 'owlbear',
    name: '枭熊',
    emoji: '🦉',
    color: '#78350f',
    maxHp: 59,
    size: 2,
    tags: ['怪兽', '大型', '野兽'],
    description: '猫头鹰与熊的可怕混合体。',
  },
  {
    id: 'harpy',
    name: '鹰身女妖',
    emoji: '🦅',
    color: '#f472b6',
    maxHp: 38,
    tags: ['怪兽', '中型', '飞行'],
    description: '拥有魅惑之歌的飞行怪物。',
  },
  {
    id: 'wyrmling-red',
    name: '红龙雏龙',
    emoji: '🐉',
    color: '#dc2626',
    maxHp: 52,
    creatureTypes: ['龙'],
    creatureSize: '大型',
    tags: ['龙类', '大型', '火焰'],
    description: '年幼的红龙，第一回合会优先使用火焰吐息。',
  },
  {
    id: 'wyrmling-green',
    name: '绿龙雏龙',
    emoji: '🐉',
    color: '#22c55e',
    maxHp: 48,
    creatureTypes: ['龙'],
    creatureSize: '大型',
    tags: ['龙类', '大型', '毒素'],
    description: '狡猾的年轻绿龙。',
  },
  {
    id: 'imp',
    name: '小魔鬼',
    emoji: '😈',
    color: '#9333ea',
    maxHp: 14,
    tags: ['邪魔', '小型', '飞行'],
    description: '小型魔鬼，擅长骚扰与戏弄。',
  },
  {
    id: 'animated-armor',
    name: '活化盔甲',
    emoji: '🤖',
    color: '#cbd5e1',
    maxHp: 33,
    tags: ['构装', '中型', '魔法'],
    description: '被魔法驱动的空盔甲。',
  },
  {
    id: 'gargoyle',
    name: '石像鬼',
    emoji: '🗿',
    color: '#57534e',
    maxHp: 52,
    size: 1.25,
    tags: ['元素', '中型', '飞行'],
    description: '石质飞行元素生物。',
  },
]

export function getEnemyTemplate(id: string): EnemyTemplate | undefined {
  return ENEMY_POOL.find((e) => e.id === id)
}

export function searchEnemyPool(query: string, pool: EnemyTemplate[] = ENEMY_POOL): EnemyTemplate[] {
  const q = query.trim().toLowerCase()
  if (!q) return pool
  return pool.filter(
    (e) =>
      e.name.toLowerCase().includes(q) ||
      e.tags.some((t) => t.toLowerCase().includes(q)) ||
      e.creatureTypes?.some((t) => t.toLowerCase().includes(q)) ||
      e.creatureSize?.toLowerCase().includes(q) ||
      e.description?.toLowerCase().includes(q),
  )
}

export function enemyTemplateToTokenPatch(template: EnemyTemplate): Partial<TokenFields> {
  const maxHp = enemyHasDerivedCombat(template.id)
    ? getEnemyMaxHp(template.id)
    : template.maxHp
  const hp = template.hp ?? maxHp
  const creatureTypes = template.creatureTypes ?? inferCreatureTypesFromTags(template.tags)
  const creatureSize = template.creatureSize ?? inferCreatureSizeFromTags(template.tags)
  return {
    label: template.name,
    emoji: template.emoji,
    color: template.color,
    maxHp,
    hp,
    size: creatureSizeToTokenSize(creatureSize),
    poolId: template.id,
    creatureTypes,
    creatureSize,
    type: 'enemy' as const,
    showHpOnToken: true,
    showDetailOnToken: true,
  }
}

/** 写入 token 的字段（避免循环依赖 maps.ts） */
export interface TokenFields {
  label: string
  emoji: string
  color: string
  maxHp?: number
  hp?: number
  size?: number
  poolId?: string
  creatureTypes?: CreatureType[]
  creatureSize?: CreatureSize
  type: 'enemy'
  showHpOnToken?: boolean
  showDetailOnToken?: boolean
}

