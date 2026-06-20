import { describe, expect, it } from 'vitest'
import type { BattleMap, Token } from '../store/maps'
import { cellToPixel, occupiedCells, pixelToCell, resolveFreeDropCell } from './gridCombat'

function token(patch: Partial<Token>): Token {
  return {
    id: 'token',
    label: 'Token',
    x: 0,
    y: 0,
    color: '#fff',
    emoji: '',
    size: 1,
    type: 'enemy',
    ...patch,
  }
}

function map(tokens: Token[]): BattleMap {
  return {
    id: 'map',
    name: 'Map',
    width: 1000,
    height: 1000,
    gridSize: 100,
    gridOffsetX: 0,
    gridOffsetY: 0,
    showGrid: true,
    tokens,
  }
}

// 在指定格心放置一个 token
function atCell(id: string, col: number, row: number, m: BattleMap, type: Token['type'] = 'enemy'): Token {
  const p = cellToPixel({ col, row }, m)
  return token({ id, x: p.x, y: p.y, type })
}

describe('[T8/AC3 · D3] occupancy on drop', () => {
  it('占用集合排除自身', () => {
    const m = map([])
    const a = atCell('a', 0, 0, m)
    const b = atCell('b', 1, 0, m)
    const full = map([a, b])
    const blockedForA = occupiedCells(full.tokens, full, 'a')
    expect(blockedForA.has('0,0')).toBe(false) // 自身格不计
    expect(blockedForA.has('1,0')).toBe(true)
  })

  it('落在空格 → 直接吸附到该格心', () => {
    const m = map([])
    const a = atCell('a', 0, 0, m)
    const full = map([a])
    // 拖到 (3,3) 的格心
    const targetPx = cellToPixel({ col: 3, row: 3 }, full)
    const pos = resolveFreeDropCell(targetPx.x, targetPx.y, 'a', full)
    expect(pixelToCell(pos.x, pos.y, full)).toEqual({ col: 3, row: 3 })
  })

  it('落在被占用格 → 改放到最近空格（不与他者共享格心）', () => {
    const m = map([])
    const a = atCell('a', 0, 0, m)
    const b = atCell('b', 2, 2, m)
    const full = map([a, b])
    // 把 a 拖到 b 所在的 (2,2)
    const targetPx = cellToPixel({ col: 2, row: 2 }, full)
    const pos = resolveFreeDropCell(targetPx.x, targetPx.y, 'a', full)
    const landed = pixelToCell(pos.x, pos.y, full)
    // 不应落在 b 的格子
    expect(landed).not.toEqual({ col: 2, row: 2 })
    // 应该是相邻的最近空格（切比雪夫距离 1）
    expect(Math.max(Math.abs(landed.col - 2), Math.abs(landed.row - 2))).toBe(1)
    // 该落点确实未被占用
    const blocked = occupiedCells(full.tokens, full, 'a')
    expect(blocked.has(`${landed.col},${landed.row}`)).toBe(false)
  })

  it('允许 token 停留在自己原本的格子（不拒绝自身）', () => {
    const m = map([])
    const a = atCell('a', 4, 4, m)
    const full = map([a])
    // a 原地放下（落点就是自身格）
    const targetPx = cellToPixel({ col: 4, row: 4 }, full)
    const pos = resolveFreeDropCell(targetPx.x, targetPx.y, 'a', full)
    expect(pixelToCell(pos.x, pos.y, full)).toEqual({ col: 4, row: 4 })
  })
})
