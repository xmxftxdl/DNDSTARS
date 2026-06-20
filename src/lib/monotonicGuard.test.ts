// [T11/AC6 · E6] 共享快照单调 guard 单测。
import { describe, expect, it } from 'vitest'
import { decideApply, type MonotonicState } from './monotonicGuard'

const fresh = (): MonotonicState => ({ lastUpdatedAt: 0, lastSnapshot: '' })

describe('decideApply — 单调 guard', () => {
  it('首个快照应用', () => {
    const d = decideApply(fresh(), 100, '{"a":1}')
    expect(d.apply).toBe(true)
    expect(d.reason).toBe('apply')
    expect(d.next).toEqual({ lastUpdatedAt: 100, lastSnapshot: '{"a":1}' })
  })

  it('严格更旧的乱序快照被丢弃（stale）', () => {
    const prev: MonotonicState = { lastUpdatedAt: 200, lastSnapshot: '{"a":2}' }
    const d = decideApply(prev, 150, '{"a":1}')
    expect(d.apply).toBe(false)
    expect(d.reason).toBe('stale')
    // 水位不回退。
    expect(d.next).toEqual(prev)
  })

  it('更新的快照应用并推进水位', () => {
    const prev: MonotonicState = { lastUpdatedAt: 100, lastSnapshot: '{"a":1}' }
    const d = decideApply(prev, 300, '{"a":3}')
    expect(d.apply).toBe(true)
    expect(d.next).toEqual({ lastUpdatedAt: 300, lastSnapshot: '{"a":3}' })
  })

  it('updatedAt 相等但内容变化 ⇒ 仍应用（equality 短路不压制合法更新）', () => {
    const prev: MonotonicState = { lastUpdatedAt: 100, lastSnapshot: '{"a":1}' }
    const d = decideApply(prev, 100, '{"a":99}')
    expect(d.apply).toBe(true)
    expect(d.reason).toBe('apply')
  })

  it('内容完全未变 ⇒ 短路（unchanged），不视为压制', () => {
    const prev: MonotonicState = { lastUpdatedAt: 100, lastSnapshot: '{"a":1}' }
    const d = decideApply(prev, 100, '{"a":1}')
    expect(d.apply).toBe(false)
    expect(d.reason).toBe('unchanged')
  })

  it('回归不变量：一个 updatedAt 更大的新内容永不被短路压制', () => {
    let state = fresh()
    // 应用一次。
    let d = decideApply(state, 100, 'A')
    state = d.next
    // 一个更旧的乱序到达 —— 丢弃。
    d = decideApply(state, 50, 'B')
    expect(d.apply).toBe(false)
    state = d.next
    // 一个更新的合法快照 —— 必须应用（不被前面的 'A' 短路）。
    d = decideApply(state, 200, 'C')
    expect(d.apply).toBe(true)
    expect(d.next.lastSnapshot).toBe('C')
  })
})
