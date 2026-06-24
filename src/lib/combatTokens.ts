import type { InitiativeEntry } from '../components/map/InitiativeTracker'
import type { Token } from '../store/maps'
import type { Character } from '../types/character'

/** 是否视为阵亡（优先用当前 HP 快照，与血条显示一致） */
export function isTokenDefeated(
  token: Token,
  characters: Character[],
  hp?: { hp: number; max: number; temp?: number },
): boolean {
  if (hp != null) return hp.hp <= 0
  return !isTokenAlive(token, characters)
}

export function isTokenAlive(token: Token, characters: Character[]): boolean {
  if (token.characterId) {
    const ch = characters.find((c) => c.id === token.characterId)
    if (ch) return ch.currentHp > 0
    if (token.maxHp != null) {
      return (token.hp ?? token.maxHp) > 0
    }
    return true
  }
  if (token.maxHp != null) {
    return (token.hp ?? token.maxHp) > 0
  }
  return true
}

/** 战斗阵营：玩家与 NPC 为友方，敌人为敌方 */
export function getTokenCombatSide(token: Token): 'ally' | 'enemy' | 'neutral' {
  if (token.type === 'obstacle') return 'neutral'
  return token.type === 'enemy' ? 'enemy' : 'ally'
}

export interface CombatOutcome {
  ended: true
  winner: 'ally' | 'enemy'
  message: string
}

/** 若某一阵营全员阵亡且该阵营在地图上有单位，则战斗结束 */
export function checkCombatOutcome(
  tokens: Token[],
  characters: Character[],
): CombatOutcome | { ended: false } {
  const allies = tokens.filter((t) => getTokenCombatSide(t) === 'ally')
  const enemies = tokens.filter((t) => getTokenCombatSide(t) === 'enemy')

  if (enemies.length > 0 && enemies.every((t) => !isTokenAlive(t, characters))) {
    return { ended: true, winner: 'ally', message: '所有敌人已被击败，战斗结束。' }
  }
  if (allies.length > 0 && allies.every((t) => !isTokenAlive(t, characters))) {
    return { ended: true, winner: 'enemy', message: '所有友方角色已阵亡，战斗结束。' }
  }
  return { ended: false }
}

export function tokenHpAfterDamage(token: Token, amount: number, characters: Character[]): number {
  if (token.characterId) {
    const ch = characters.find((c) => c.id === token.characterId)
    if (ch) return Math.max(0, ch.currentHp - amount)
  }
  if (token.maxHp != null) {
    return Math.max(0, (token.hp ?? token.maxHp) - amount)
  }
  return 0
}

/** 从先攻列表移除 token，并返回新的先攻索引 */
export function pruneInitiativeForToken(
  order: InitiativeEntry[],
  currentIndex: number,
  tokenId: string,
): { order: InitiativeEntry[]; index: number } {
  const removeAt = order.findIndex((e) => e.tokenId === tokenId)
  if (removeAt < 0) return { order, index: currentIndex }
  const nextOrder = order.filter((e) => e.tokenId !== tokenId)
  if (nextOrder.length === 0) return { order: nextOrder, index: 0 }
  let index = currentIndex
  if (removeAt < index) index -= 1
  else if (removeAt === index) index = Math.min(index, nextOrder.length - 1)
  return { order: nextOrder, index: Math.max(0, index) }
}

/**
 * [T1/A1/A2/BUG③ · T3/C2] 回合驱动器对当前先攻槽 token 的纯决策：把 MapsPage 回合驱动
 * effect 里内联的「prune / 死亡跳过 / 眩晕跳过 / 非行动者跳过 / 敌人 / 玩家」分支抽成
 * 一个无副作用函数，便于 T13 在不挂载组件的前提下单测 npc 自动跳过与全 npc 队列不死循环。
 *
 * 返回值语义与 effect 中各分支一一对应：
 * - 'prune'  → token 已不在地图上，应从先攻列表剔除（effect 仍负责真正剔除 + 重排索引）
 * - 'skip'   → 死亡 / 眩晕 / 存活非行动者（npc/obstacle），自动推进
 * - 'enemy'  → 存活敌人，安排敌人回合
 * - 'player' → 存活玩家，开始玩家回合
 *
 * 注意：'skip' 把死亡、眩晕、非行动者三类合并为同一外部动作（都走 requestAdvance），与
 * effect 中三个独立分支的「行为」完全一致 —— effect 各自的去重 key/日志属副作用，由 effect
 * 持有，不进纯函数。决策顺序与 effect 严格一致：prune → dead → stun → non-actor → enemy/player。
 */
export type TurnAction = 'prune' | 'skip' | 'enemy' | 'player'

export function decideTurnAction(
  token: Token | undefined,
  characters: Character[],
): TurnAction {
  if (!token) return 'prune'
  if (!isTokenAlive(token, characters)) return 'skip'
  if ((token.stunTurns ?? 0) > 0) return 'skip'
  if (token.type !== 'player' && token.type !== 'enemy') return 'skip'
  return token.type === 'enemy' ? 'enemy' : 'player'
}

/**
 * [T1/AC4] 给定一整条先攻列表，判断是否存在「可行动者」（存活的 player 或 enemy）。effect 用它
 * 在全 npc/obstacle 队列时停手（parked），避免无限自旋。把它抽成纯函数同样便于 T13 直接验证
 * 全 npc 队列不会被无休止推进。
 */
export function hasActionableActor(
  order: InitiativeEntry[],
  tokens: Token[],
  characters: Character[],
): boolean {
  const tokenById = new Map(tokens.map((t) => [t.id, t]))
  return order.some((e) => {
    const t = tokenById.get(e.tokenId)
    return !!t && (t.type === 'player' || t.type === 'enemy') && isTokenAlive(t, characters)
  })
}

/**
 * [T2/A11] prune-to-0 恢复决策：当某 token 被剔除后索引落到 0，而 index 0 指向的 token 本回合
 * 已经行动过（其去重 key 在 actedKeys 里），回合驱动器必须强制推过它而不是卡在 index 0 死锁。
 * 这里把「prune 后该不该继续推进」抽成纯函数：
 * - 列表已空（length 0）→ 不再有可推进对象，返回 advance=false（由调用方走 endCombat 判定）。
 * - index 落点的 token 本回合已行动（key 命中）→ advance=true，调用方应再推一格。
 * - 否则 → advance=false，正常停在该 token 上。
 * keyFor 给定 (round, index, tokenId) 生成与 effect 一致的去重 key（如 `${round}-${index}-${id}`）。
 */
export function pruneRecovery(
  order: InitiativeEntry[],
  index: number,
  round: number,
  actedKeys: ReadonlySet<string>,
  keyFor: (round: number, index: number, tokenId: string) => string,
): { advance: boolean } {
  if (order.length === 0) return { advance: false }
  const entry = order[index]
  if (!entry) return { advance: false }
  const key = keyFor(round, index, entry.tokenId)
  return { advance: actedKeys.has(key) }
}
