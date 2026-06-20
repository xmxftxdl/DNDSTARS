import type { BattleMap, Token } from '../store/maps'
import type { Character } from '../types/character'
import { abilityMod } from './dnd'
import { getEnemyStatBlock, getPrimaryAttackAction, type MonsterAction } from './enemyStatBlocks'
import {
  cellDistance,
  cellToPixel,
  isHostileToEnemy,
  occupiedCells,
  pixelToCell,
  stepToward,
  type GridCell,
} from './gridCombat'

const MOVE_CELLS_PER_TURN = 6
const MELEE_RANGE_CELLS = 1
/** 无结构化攻击数据时的回退骰（理论上 post-T6 不应触发） */
const FALLBACK_ATTACK_DICE = { count: 1, sides: 6 }

/** [T7/AC1] 解析 'XdY+Z' / 'XdY' 形式的伤害骰；解析失败回退到 1d6。 */
function parseDamageDice(dice: string | undefined): { count: number; sides: number; bonus: number } {
  const match = dice?.match(/^(\d+)d(\d+)([+-]\d+)?$/i)
  if (!match) return { count: FALLBACK_ATTACK_DICE.count, sides: FALLBACK_ATTACK_DICE.sides, bonus: 0 }
  return {
    count: Math.max(1, Number(match[1])),
    sides: Math.max(2, Number(match[2])),
    bonus: match[3] ? Number(match[3]) : 0,
  }
}

/**
 * [T7/AC6] stale/unknown poolId 回退到固定 dexBonus 时，按 token id 去重告警一次。
 * 战斗结束时由 clearEnemyAiWarnings() 清空，避免长时间运行无界增长。
 */
const warnedFallbackTokenIds = new Set<string>()

/** [T7/AC6] 战斗结束生命周期钩子：清空回退告警去重集合。 */
export function clearEnemyAiWarnings(): void {
  warnedFallbackTokenIds.clear()
}

export interface EnemyAttackRoll {
  values: number[]
  sides: number
  bonus: number
  total: number
  label: string
  targetName: string
}

export interface EnemyTurnResult {
  moved: boolean
  moveApSpent?: number
  newPosition?: { x: number; y: number }
  attacked: boolean
  attackerTokenId?: string
  targetTokenId?: string
  attack?: EnemyAttackRoll
  /** 物理攻击默认命中；范围法术需敏捷豁免 */
  damageType?: 'physical' | 'aoe'
  /** 范围法术敏捷豁免 DC */
  saveDC?: number
  /** 对关联角色的伤害 */
  targetCharacterId?: string
  damage?: number
  message: string
}

function enemyMeleeDexBonus(enemy: Token): number {
  if (enemy.poolId) {
    const stats = getEnemyStatBlock(enemy.poolId)
    if (stats) return abilityMod(stats.abilities.dex)
  }
  // [T7/AC6] 缺失/陈旧 poolId → 固定回退 dexBonus=2，按 token id 去重告警一次。
  if (!warnedFallbackTokenIds.has(enemy.id)) {
    warnedFallbackTokenIds.add(enemy.id)
    console.warn(
      `[enemyAi] token ${enemy.id}（poolId=${enemy.poolId ?? '无'}）缺少有效 stat block，` +
        `回退到固定近战敏捷加值 2。`,
    )
  }
  return 2
}

function findNearestPlayer(
  enemyCell: GridCell,
  players: Token[],
  map: BattleMap,
): { token: Token; cell: GridCell; dist: number } | null {
  let best: { token: Token; cell: GridCell; dist: number } | null = null
  for (const t of players) {
    const cell = pixelToCell(t.x, t.y, map)
    const dist = cellDistance(enemyCell, cell)
    if (!best || dist < best.dist) best = { token: t, cell, dist }
  }
  return best
}

function moveTowardTarget(
  start: GridCell,
  target: GridCell,
  map: BattleMap,
  tokens: Token[],
  enemyId: string,
  maxSteps: number,
): GridCell {
  let current = start
  const blocked = occupiedCells(tokens, map, enemyId)

  for (let i = 0; i < maxSteps; i++) {
    if (cellDistance(current, target) <= MELEE_RANGE_CELLS) break
    const next = stepToward(current, target)
    if (cellDistance(next, target) >= cellDistance(current, target)) break
    const key = `${next.col},${next.row}`
    if (blocked.has(key)) break
    current = next
    blocked.add(key)
  }
  return current
}

/** 敌人回合：向最近玩家移动，邻接后近战攻击一次 */
function resolveTokenCharacterId(token: Token): string | undefined {
  if (token.characterId) return token.characterId
  return undefined
}

function enemyRangedRangeCells(enemy: Token, map: BattleMap): number | null {
  if (!enemy.poolId) return null
  const block = getEnemyStatBlock(enemy.poolId)
  const rangedAction = block?.actions.find((action) => /远程|射程|短弓|长弓|弩|标枪/.test(action.description))
  if (!rangedAction) return null
  const match = rangedAction.description.match(/射程\s*(\d+)/)
  const feet = match ? Number(match[1]) : 80
  const feetPerCell = Math.max(1, map.feetPerCell ?? 5)
  return Math.max(1, Math.floor(feet / feetPerCell))
}

/**
 * [T7/AC1] 选取本次攻击使用的结构化动作：
 * 远程优先含 damageDice 的远程动作；近战走主攻击（getPrimaryAttackAction）。
 * 缺失时回退到主攻击。多重攻击的怪物只取主攻击（一次），见 Edge Cases。
 */
function selectAttackAction(
  block: ReturnType<typeof getEnemyStatBlock>,
  kind: 'melee' | 'ranged',
): MonsterAction | undefined {
  if (!block) return undefined
  if (kind === 'ranged') {
    const ranged = block.actions.find((a) => a.kind === 'ranged' && !!a.damageDice)
    if (ranged) return ranged
  }
  return getPrimaryAttackAction(block)
}

function buildEnemyAttack(
  enemy: Token,
  target: Token,
  moved: boolean,
  pos: { x: number; y: number } | undefined,
  kind: 'melee' | 'ranged',
): EnemyTurnResult {
  const values: number[] = []
  const total = 1

  // [T7/AC1] 标签/骰面/命中加值来自怪物的结构化主攻击（damageDice/damageType/toHit），
  // 不再硬编码全局 1d6。inferEnemyDamageDiceCount 会从 label 解析 \d+d\d+。
  const block = enemy.poolId ? getEnemyStatBlock(enemy.poolId) : undefined
  const action = selectAttackAction(block, kind)
  let sides: number
  let diceLabel: string
  let attackBonus: number

  if (action?.damageDice) {
    const parsed = parseDamageDice(action.damageDice)
    sides = parsed.sides
    attackBonus = parsed.bonus
    diceLabel = action.damageDice
  } else {
    // 无结构化攻击数据（理论上 post-T6 不应发生）→ 回退骰 + 敏捷加值（AC6 告警在此路径）。
    const dexBonus = enemyMeleeDexBonus(enemy)
    sides = FALLBACK_ATTACK_DICE.sides
    attackBonus = dexBonus
    diceLabel = `${FALLBACK_ATTACK_DICE.count}d${FALLBACK_ATTACK_DICE.sides}${dexBonus >= 0 ? '+' : ''}${dexBonus}`
  }

  const attackName = action?.name ?? (kind === 'ranged' ? '远程' : '近战')
  const targetCharacterId = resolveTokenCharacterId(target)

  const result: EnemyTurnResult = {
    moved,
    moveApSpent: moved ? 1 : 0,
    newPosition: pos,
    attacked: true,
    attackerTokenId: enemy.id,
    targetTokenId: target.id,
    attack: {
      values,
      sides,
      bonus: attackBonus,
      total,
      label: `${kind === 'ranged' ? '远程' : '近战'}·${attackName} ${diceLabel}`,
      targetName: target.label,
    },
    damage: total,
    message: `${enemy.label} ${moved ? '移动后' : ''}${kind === 'ranged' ? '远程攻击' : '攻击'} ${target.label}，造成 ${total} 点伤害。`,
  }

  if (targetCharacterId) {
    result.targetCharacterId = targetCharacterId
  }

  return result
}

/**
 * [T7/AC3] 数据驱动的吐息分支：任何怪物只要其 stat block 含一个
 * `kind:'aoe'` 且带 `save` 的结构化动作，就在第一回合默认使用该吐息，
 * 不再针对 'wyrmling-red' 做字符串特判。红/绿龙皆由数据驱动。
 */
function buildBreathAttack(
  enemy: Token,
  target: Token,
  breath: MonsterAction,
): EnemyTurnResult {
  const parsed = parseDamageDice(breath.damageDice)
  // 估算伤害（满额 = count*sides）；MapsPage 会按 label 重新投骰，total 仅作占位。
  const estimate = parsed.count * parsed.sides + parsed.bonus
  const dc = breath.save?.dc ?? 12
  return {
    moved: false,
    attacked: true,
    attackerTokenId: enemy.id,
    targetTokenId: target.id,
    damageType: 'aoe',
    saveDC: dc,
    attack: {
      values: [],
      sides: parsed.sides,
      bonus: parsed.bonus,
      total: estimate,
      label: `${breath.name} ${breath.damageDice ?? ''}（豁免成功半伤）`.trim(),
      targetName: target.label,
    },
    damage: estimate,
    targetCharacterId: resolveTokenCharacterId(target),
    message: `${enemy.label} 使用${breath.name}，${target.label} 进行 DC${dc} 豁免。`,
  }
}

/** [T7/AC3] 取怪物的吐息动作（kind:'aoe' 且带 save）。 */
function findBreathAction(enemy: Token): MonsterAction | undefined {
  if (!enemy.poolId) return undefined
  const block = getEnemyStatBlock(enemy.poolId)
  return block?.actions.find((a) => a.kind === 'aoe' && !!a.save)
}

export function planEnemyTurn(
  map: BattleMap,
  enemy: Token,
  _characters?: Character[],
  availableAp = 2,
  context?: { round?: number },
): EnemyTurnResult {
  // [T7/AC2] 目标集合 = 玩家 + npc/友方（敌对于敌人），排除 enemy-vs-enemy 与障碍。
  const targets = map.tokens.filter(isHostileToEnemy)
  if (targets.length === 0) {
    return { moved: false, attacked: false, message: `${enemy.label} 找不到可攻击目标。` }
  }

  const startCell = pixelToCell(enemy.x, enemy.y, map)
  const nearest = findNearestPlayer(startCell, targets, map)!
  const rangedRangeCells = enemyRangedRangeCells(enemy, map)
  // [T7/AC3] 数据驱动吐息：第一回合默认优先使用（红/绿龙等）。
  const breath = findBreathAction(enemy)
  if (breath && (context?.round ?? 1) === 1 && availableAp >= 1) {
    return buildBreathAttack(enemy, nearest.token, breath)
  }
  let endCell = startCell

  const startDist = cellDistance(startCell, nearest.cell)
  if (startDist > MELEE_RANGE_CELLS && rangedRangeCells != null && startDist <= rangedRangeCells) {
    return buildEnemyAttack(enemy, nearest.token, false, undefined, 'ranged')
  }
  const canDoubleMove = availableAp >= 2
  const needsDoubleMove = canDoubleMove && startDist > MOVE_CELLS_PER_TURN + MELEE_RANGE_CELLS
  const moveBudget = needsDoubleMove ? MOVE_CELLS_PER_TURN * 2 : MOVE_CELLS_PER_TURN

  if (startDist > MELEE_RANGE_CELLS) {
    endCell = moveTowardTarget(startCell, nearest.cell, map, map.tokens, enemy.id, moveBudget)
  }

  const moved = endCell.col !== startCell.col || endCell.row !== startCell.row
  const moveApSpent = moved ? (needsDoubleMove ? 2 : 1) : 0
  const afterMoveDist = cellDistance(endCell, nearest.cell)
  const pos = moved ? cellToPixel(endCell, map) : undefined
  const canRangedAfterMove = rangedRangeCells != null && afterMoveDist <= rangedRangeCells

  if (afterMoveDist > MELEE_RANGE_CELLS && canRangedAfterMove && moveApSpent < availableAp) {
    return buildEnemyAttack(enemy, nearest.token, moved, pos, 'ranged')
  }

  if (afterMoveDist > MELEE_RANGE_CELLS || moveApSpent >= availableAp) {
    return {
      moved,
      moveApSpent,
      newPosition: pos,
      attacked: false,
      message: moved
        ? `${enemy.label} 向 ${nearest.token.label} 移动，但够不着。`
        : `${enemy.label} 无法靠近 ${nearest.token.label}。`,
    }
  }

  const target = nearest.token
  return { ...buildEnemyAttack(enemy, target, moved, pos, 'melee'), moveApSpent }
}
