import { describe, expect, it } from 'vitest'
import type { Token } from '../store/maps'
import {
  applyAttackDefenseDamageModifier,
  VULNERABLE_DAMAGE_MULTIPLIER,
} from './combatStats'
import { isMovementLocked, isTokenMovementLocked } from './combatStatus'
import { NO_MOVE_STATUS_LABEL, RESTRAINED_STATUS_LABEL } from './tokenStatus'

// [T13/AC4] 覆盖 T4 落地的真实机制：脆弱伤害乘子（combatStats.applyAttackDefenseDamageModifier，
// 真实伤害路径调用的同一函数）+ 束缚移动锁谓词（combatStatus.isMovementLocked /
// isTokenMovementLocked，真实移动门调用的同一谓词）。不碰 dead 框架。

function lockToken(patch: Partial<Token>): Pick<Token, 'restrainedTurns' | 'noMoveTurns'> {
  return { restrainedTurns: 0, noMoveTurns: 0, ...patch }
}

describe('T13/AC4 — vulnerable damage multiplier (both branches)', () => {
  it('true-type damage with defenderVulnerable=true is multiplied by VULNERABLE_DAMAGE_MULTIPLIER', () => {
    // type='true' 走早返回分支：damage = floor(base * vulnMult)，直接验证脆弱乘子生效。
    const base = 20
    const notVulnerable = applyAttackDefenseDamageModifier(base, undefined, undefined, 'true', false)
    const vulnerable = applyAttackDefenseDamageModifier(base, undefined, undefined, 'true', true)
    expect(notVulnerable.damage).toBe(base)
    expect(vulnerable.damage).toBe(Math.floor(base * VULNERABLE_DAMAGE_MULTIPLIER))
    expect(vulnerable.damage).toBeGreaterThan(notVulnerable.damage)
  })

  it('vulnerableTurns==0 branch (defenderVulnerable=false) leaves integer damage byte-identical (regression anchor)', () => {
    for (const base of [1, 7, 13, 25, 100]) {
      const r = applyAttackDefenseDamageModifier(base, undefined, undefined, 'true', false)
      expect(r.damage).toBe(base) // ×1 ⇒ 不变
    }
  })

  it('the multiplier constant is the documented defense -25% ⇒ ×1.25 taken', () => {
    expect(VULNERABLE_DAMAGE_MULTIPLIER).toBe(1.25)
  })
})

describe('T13/AC4 — restrained movement-lock predicate (both branches)', () => {
  it('token-level: restrainedTurns>0 locks movement; ==0 frees it', () => {
    expect(isTokenMovementLocked(lockToken({ restrainedTurns: 1 }))).toBe(true)
    expect(isTokenMovementLocked(lockToken({ restrainedTurns: 0 }))).toBe(false)
  })

  it('token-level: noMoveTurns is folded into the SAME single lock predicate (T4/C8)', () => {
    expect(isTokenMovementLocked(lockToken({ noMoveTurns: 2 }))).toBe(true)
    // 二者都不锁 ⇒ 自由移动
    expect(isTokenMovementLocked(lockToken({}))).toBe(false)
    // 同时设置也只有一个门判定为锁（不双锁）
    expect(isTokenMovementLocked(lockToken({ restrainedTurns: 1, noMoveTurns: 1 }))).toBe(true)
  })

  it('condition-label predicate: restrained OR no-move label locks; neither frees', () => {
    expect(isMovementLocked([RESTRAINED_STATUS_LABEL])).toBe(true)
    expect(isMovementLocked([NO_MOVE_STATUS_LABEL])).toBe(true)
    expect(isMovementLocked(['脆弱', '燃烧'])).toBe(false)
    expect(isMovementLocked([])).toBe(false)
  })
})
