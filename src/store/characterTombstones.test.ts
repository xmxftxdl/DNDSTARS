import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearCharacterTombstonesForTest,
  filterTombstonedCharacters,
  gcCharacterTombstones,
  isCharacterTombstoned,
  recordCharacterTombstone,
} from './characters'
import type { Character } from '../types/character'

// [T10/AC2 · E11] 删除墓碑防复活：删除一个角色后，对端一份仍含该角色的「全量数组」快照
// 不得在 loadShared 里把它复活；墓碑过期 GC 后被删 id 可复用。
// 这里直接单测 loadShared 所依赖的纯过滤 helper 与墓碑 GC 语义。

function char(id: string): Character {
  return { id } as unknown as Character
}

describe('T10/AC2 — deletion tombstones suppress resurrection', () => {
  beforeEach(() => {
    clearCharacterTombstonesForTest()
  })

  it('a stale shared snapshot still containing the deleted entity does NOT resurrect it', () => {
    const now = 1_000_000
    // 模拟本地删除：立墓碑
    recordCharacterTombstone('hero', now)

    // 对端推来的全量快照仍含 hero（删除尚未传播到对端）
    const staleSnapshot = [char('hero'), char('mage'), char('rogue')]
    const applied = filterTombstonedCharacters(staleSnapshot, now + 100)

    expect(applied.map((c) => c.id)).toEqual(['mage', 'rogue'])
    expect(applied.some((c) => c.id === 'hero')).toBe(false)
  })

  it('tombstones GC/expire after the bounded window so the id can be reused', () => {
    const now = 2_000_000
    recordCharacterTombstone('hero', now)
    expect(isCharacterTombstoned('hero', now + 100)).toBe(true)

    // 远超 TTL（10s）后墓碑应被 GC，id 可复用
    const later = now + 60_000
    expect(gcCharacterTombstones(later)).toBe(0)
    expect(isCharacterTombstoned('hero', later)).toBe(false)

    // 复用该 id 重新创建的同名角色不再被墓碑误杀
    const reused = filterTombstonedCharacters([char('hero')], later)
    expect(reused.map((c) => c.id)).toEqual(['hero'])
  })

  it('does not touch non-tombstoned entities', () => {
    const now = 3_000_000
    const snapshot = [char('a'), char('b')]
    expect(filterTombstonedCharacters(snapshot, now)).toBe(snapshot)
  })
})
