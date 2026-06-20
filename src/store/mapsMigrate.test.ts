import { describe, expect, it } from 'vitest'
import { migrateMapsState, MAPS_PERSIST_VERSION } from './maps'

// [T10/AC3 · E10] maps store 此前裸跑 `{ name:'stars-maps' }`（无 version/migrate）。
// 任何旧 localStorage 形状缺字段都可能在渲染期崩。这里验证 v0（无版本）旧 blob 经 migrate
// 被规整为可直接渲染的当前 BattleMap 形状，且 version 已落定。

describe('T10/AC3 — maps store version + migrate', () => {
  it('exposes a non-zero persist version', () => {
    expect(MAPS_PERSIST_VERSION).toBeGreaterThan(0)
  })

  it('migrates a v0 (versionless) legacy blob into a valid current shape without crashing', () => {
    // 早期形状：token 缺 color/emoji/size/type，map 缺 grid* 字段，tokens 可能整个缺失。
    const v0Blob = {
      maps: [
        {
          id: 'map-legacy',
          name: '旧地图',
          width: 800,
          height: 600,
          tokens: [
            { id: 'tok-legacy', label: '老怪' }, // 缺 x/y/color/emoji/size/type
          ],
        },
        {
          // 极端残缺：几乎什么都没有
          id: 'map-bare',
        },
      ],
      selectedId: 'map-legacy',
    }

    const result = migrateMapsState(v0Blob)

    expect(result.maps).toHaveLength(2)
    const m0 = result.maps[0]
    expect(m0.id).toBe('map-legacy')
    expect(m0.gridSize).toBeGreaterThan(0)
    expect(typeof m0.showGrid).toBe('boolean')
    expect(Array.isArray(m0.tokens)).toBe(true)

    const tok = m0.tokens[0]
    expect(tok.id).toBe('tok-legacy')
    // 缺失字段被填默认，渲染所依赖的字段全部有值
    expect(typeof tok.color).toBe('string')
    expect(tok.color.length).toBeGreaterThan(0)
    expect(typeof tok.emoji).toBe('string')
    expect(tok.size).toBeGreaterThan(0)
    expect(['player', 'enemy', 'npc', 'obstacle']).toContain(tok.type)
    expect(Number.isFinite(tok.x)).toBe(true)
    expect(Number.isFinite(tok.y)).toBe(true)

    // 残缺地图也被补成可渲染形状
    const m1 = result.maps[1]
    expect(Number.isFinite(m1.width)).toBe(true)
    expect(Number.isFinite(m1.height)).toBe(true)
    expect(Array.isArray(m1.tokens)).toBe(true)

    expect(result.selectedId).toBe('map-legacy')
  })

  it('tolerates a completely empty / undefined persisted blob', () => {
    expect(migrateMapsState(undefined)).toEqual({ maps: [], selectedId: null })
    expect(migrateMapsState({})).toEqual({ maps: [], selectedId: null })
  })

  it('drops a dangling selectedId that no longer points at an existing map', () => {
    const result = migrateMapsState({ maps: [{ id: 'a', name: 'A' }], selectedId: 'gone' })
    expect(result.selectedId).toBe('a')
  })
})
