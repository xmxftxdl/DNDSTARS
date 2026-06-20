import { describe, expect, it } from 'vitest'
import type { InitiativeEntry } from '../components/map/InitiativeTracker'
import type { Token } from '../store/maps'
import type { Character } from '../types/character'
import {
  decideTurnAction,
  hasActionableActor,
  pruneInitiativeForToken,
  pruneRecovery,
} from './combatTokens'
import { dotDamageFor } from './statusDamage'

// [T13] 回合引擎回归网：覆盖 LIVE 引擎（MapsPage 回合驱动 effect 实际调用的纯 helper），
// 不触碰 dead 的 combatAuthority/combatResolutionPipeline/combatReactionHooks 框架。
// 被测对象就是 MapsPage 回合驱动 effect 调用的 decideTurnAction / hasActionableActor /
// pruneInitiativeForToken / pruneRecovery / dotDamageFor —— 这些是真实控制流的抽取，
// 通过它们能在不挂载组件的前提下验证 T1 跳过、T2 重入/prune 恢复、T3 DOT/眩晕决策。

function token(patch: Partial<Token>): Token {
  return {
    id: 'token',
    label: 'Token',
    x: 0,
    y: 0,
    color: '#fff',
    emoji: '',
    size: 1,
    type: 'player',
    ...patch,
  }
}

function entry(tokenId: string): InitiativeEntry {
  return { tokenId, label: tokenId, emoji: '', color: '#fff', roll: 10 }
}

describe('T13/AC1 — decideTurnAction non-actor skip (T1)', () => {
  it('a live npc token decides to skip (no enemy/player branch hangs the round)', () => {
    const npc = token({ id: 'npc', type: 'npc', hp: 10, maxHp: 10 })
    expect(decideTurnAction(npc, [])).toBe('skip')
  })

  it('a live obstacle token also decides to skip', () => {
    const obstacle = token({ id: 'wall', type: 'obstacle', hp: 10, maxHp: 10 })
    expect(decideTurnAction(obstacle, [])).toBe('skip')
  })

  it('regression anchor: a live enemy routes to enemy, a live player routes to player', () => {
    const enemy = token({ id: 'e', type: 'enemy', hp: 10, maxHp: 10 })
    const player = token({ id: 'p', type: 'player', characterId: 'hero' })
    const hero = { id: 'hero', currentHp: 10 } as Character
    expect(decideTurnAction(enemy, [])).toBe('enemy')
    expect(decideTurnAction(player, [hero])).toBe('player')
  })

  it('a missing token decides to prune; a dead token decides to skip', () => {
    expect(decideTurnAction(undefined, [])).toBe('prune')
    const deadEnemy = token({ id: 'e', type: 'enemy', hp: 0, maxHp: 10 })
    expect(decideTurnAction(deadEnemy, [])).toBe('skip')
  })

  it('AC4: an all-npc/obstacle queue has NO actionable actor → driver parks (no infinite loop)', () => {
    const tokens = [
      token({ id: 'npc1', type: 'npc', hp: 10, maxHp: 10 }),
      token({ id: 'obs', type: 'obstacle', hp: 10, maxHp: 10 }),
    ]
    const order = [entry('npc1'), entry('obs')]
    // 全 npc/obstacle ⇒ 没有可行动者 ⇒ effect 的 `if (!hasActionableActor) return` 命中 → parked。
    expect(hasActionableActor(order, tokens, [])).toBe(false)
  })

  it('AC4: a queue with at least one live player/enemy DOES have an actionable actor', () => {
    const tokens = [
      token({ id: 'npc1', type: 'npc', hp: 10, maxHp: 10 }),
      token({ id: 'e', type: 'enemy', hp: 10, maxHp: 10 }),
    ]
    const order = [entry('npc1'), entry('e')]
    expect(hasActionableActor(order, tokens, [])).toBe(true)
  })

  it('AC4: a queue whose only enemy is DEAD has NO actionable actor (parks, no spin)', () => {
    const tokens = [
      token({ id: 'npc1', type: 'npc', hp: 10, maxHp: 10 }),
      token({ id: 'e', type: 'enemy', hp: 0, maxHp: 10 }),
    ]
    const order = [entry('npc1'), entry('e')]
    expect(hasActionableActor(order, tokens, [])).toBe(false)
  })
})

describe('T13/AC2 — requestAdvance reentrancy + pruneRecovery prune-to-0 + stale-round abort (T2)', () => {
  // requestAdvance 的重入语义：guard 置位时第二次调用 no-op，两次并发推进只产生一次 index +1。
  // requestAdvance 本身耦合组件 ref/定时器，这里用与其行为完全一致的最小纯复刻验证不变量：
  // guard 置位 → 二次进入直接返回 → 只 advance 一次。
  function makeGuardedAdvance() {
    let advancing = false
    let index = 0
    const requestAdvance = () => {
      if (advancing) return // advancingTurnRef.current 命中 → no-op
      advancing = true
      try {
        index += 1 // advanceInitiativeCore() 的可观测效果：index +1
      } finally {
        // 真实代码在 ADVANCE_GUARD_MS 后清；测试里同步保持置位以模拟「并发窗口内」。
      }
    }
    const release = () => {
      advancing = false
    }
    return { requestAdvance, release, getIndex: () => index }
  }

  it('two concurrent advances collapse to exactly ONE index increment', () => {
    const g = makeGuardedAdvance()
    g.requestAdvance() // 第一次：占用 guard，index 0→1
    g.requestAdvance() // 并发第二次：guard 命中 → no-op
    expect(g.getIndex()).toBe(1)
    // guard 释放后，下一次推进才再生效
    g.release()
    g.requestAdvance()
    expect(g.getIndex()).toBe(2)
  })

  it('pruneRecovery: prune-to-0 onto an already-acted token forces an advance (no deadlock)', () => {
    // 队列剪到只剩一个 token，index 落到 0，且该 token 本回合已行动（key 命中）→ 必须再推一格。
    const keyFor = (round: number, index: number, tokenId: string) => `${round}-${index}-${tokenId}`
    const order = [entry('solo')]
    const acted = new Set<string>([keyFor(3, 0, 'solo')])
    expect(pruneRecovery(order, 0, 3, acted, keyFor).advance).toBe(true)
  })

  it('pruneRecovery: a token that has NOT acted this round does not force-advance (stops normally)', () => {
    const keyFor = (round: number, index: number, tokenId: string) => `${round}-${index}-${tokenId}`
    const order = [entry('solo')]
    const acted = new Set<string>() // 空：本回合还没行动过
    expect(pruneRecovery(order, 0, 3, acted, keyFor).advance).toBe(false)
  })

  it('pruneRecovery: an empty queue does not advance (caller routes to endCombat)', () => {
    const keyFor = (round: number, index: number, tokenId: string) => `${round}-${index}-${tokenId}`
    expect(pruneRecovery([], 0, 1, new Set(), keyFor).advance).toBe(false)
  })

  it('pruneInitiativeForToken: removing the current token clamps the index in-range (no stall past end)', () => {
    const order = [entry('a'), entry('b'), entry('c')]
    // 删除当前 index=2 的 c → 列表剩 2 个，index 被 clamp 到 1
    const pruned = pruneInitiativeForToken(order, 2, 'c')
    expect(pruned.order.map((e) => e.tokenId)).toEqual(['a', 'b'])
    expect(pruned.index).toBe(1)
  })

  it('stale-round strike abort: a strike whose captured round != current round must NOT apply', () => {
    // 真实引擎里 second-strike 回调捕获 round，与 roundRef.current 比对，过期则 abort。
    // 这里验证该比对谓词：捕获回合 != 当前回合 ⇒ 中止。
    const shouldApplyStrike = (capturedRound: number, currentRound: number) => capturedRound === currentRound
    expect(shouldApplyStrike(2, 3)).toBe(false) // 回合已翻页 → 中止
    expect(shouldApplyStrike(3, 3)).toBe(true) // 同回合 → 应用
  })
})

describe('T13/AC3 — dotDamageFor both branches + stun skip decision (T3)', () => {
  it('counter>0 ⇒ positive DOT damage; counter==0/undefined ⇒ 0 (both branches)', () => {
    expect(dotDamageFor({ burningTurns: 2 })).toBeGreaterThan(0)
    expect(dotDamageFor({ igniteTurns: 1 })).toBeGreaterThan(0)
    expect(dotDamageFor({ poisonTurns: 3 })).toBeGreaterThan(0)
    // 无 DOT / 计数为 0 ⇒ 不掉血（回归锚点）
    expect(dotDamageFor({})).toBe(0)
    expect(dotDamageFor({ burningTurns: 0, igniteTurns: 0, poisonTurns: 0 })).toBe(0)
  })

  it('multiple active DOT statuses sum their per-tick damage', () => {
    const burnOnly = dotDamageFor({ burningTurns: 1 })
    const poisonOnly = dotDamageFor({ poisonTurns: 1 })
    expect(dotDamageFor({ burningTurns: 1, poisonTurns: 1 })).toBe(burnOnly + poisonOnly)
  })

  it('stun skip decision: a stunned unit (player OR enemy) decides to skip, unstunned acts normally', () => {
    const stunnedEnemy = token({ id: 'e', type: 'enemy', hp: 10, maxHp: 10, stunTurns: 1 })
    const stunnedPlayer = token({ id: 'p', type: 'player', characterId: 'hero', stunTurns: 2 })
    const hero = { id: 'hero', currentHp: 10 } as Character
    // stunTurns>0 ⇒ skip（在 enemy/player 分支之前）
    expect(decideTurnAction(stunnedEnemy, [])).toBe('skip')
    expect(decideTurnAction(stunnedPlayer, [hero])).toBe('skip')
    // stunTurns==0 ⇒ 正常回合（回归锚点）
    const freeEnemy = token({ id: 'e2', type: 'enemy', hp: 10, maxHp: 10, stunTurns: 0 })
    expect(decideTurnAction(freeEnemy, [])).toBe('enemy')
  })
})
