import { describe, expect, it } from 'vitest'
import { reconcileEnemyAp } from './MapsPage'

// [T10/AC4 · E13] enemyApByToken 本就是 SharedCombatState 的字段、随 publishCombatState 持久化、
// loadShared 时 restore（已是服务端持久化）。这里验证 restore 路径确实生效，并硬化撕裂读边界：
//  - 快照带了字段（即便 {}）⇒ 权威全量。
//  - 字段缺失（撕裂/旧形状）且本端已有已花 AP ⇒ 保留本端，不要把已花 AP 冲回默认。

const ids = (s: string[]) => new Set(s)

describe('T10/AC4 — enemyAP restore + torn-read hardening', () => {
  it('restore path fires: a snapshot carrying spent AP restores it (reload mid-encounter)', () => {
    const incoming = { e1: { current: 0, max: 2 }, e2: { current: 1, max: 2 } }
    const restored = reconcileEnemyAp(incoming, {}, ids(['e1', 'e2']))
    expect(restored).toEqual({ e1: { current: 0, max: 2 }, e2: { current: 1, max: 2 } })
  })

  it('torn read: missing field while local holds spent AP ⇒ preserve local (no phantom AP recovery)', () => {
    const existing = { e1: { current: 0, max: 2 } } // 敌人本回合已耗尽 AP
    const reconciled = reconcileEnemyAp(undefined, existing, ids(['e1']))
    // 撕裂读不得把已花 AP 冲回空（空会让显示回落到默认 {2,2}）
    expect(reconciled).toEqual({ e1: { current: 0, max: 2 } })
  })

  it('authoritative empty: snapshot present as {} (genuine round reset) overrides local', () => {
    const existing = { e1: { current: 0, max: 2 } }
    const reconciled = reconcileEnemyAp({}, existing, ids(['e1']))
    expect(reconciled).toEqual({})
  })

  it('filters out AP for tokens no longer on the map', () => {
    const incoming = { e1: { current: 1, max: 2 }, gone: { current: 2, max: 2 } }
    const reconciled = reconcileEnemyAp(incoming, {}, ids(['e1']))
    expect(reconciled).toEqual({ e1: { current: 1, max: 2 } })
  })

  it('torn read with empty local ⇒ stays empty (nothing to preserve)', () => {
    expect(reconcileEnemyAp(undefined, {}, ids(['e1']))).toEqual({})
  })
})
