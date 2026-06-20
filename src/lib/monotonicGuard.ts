// [T11/AC6 · E6] 共享快照应用的单调 guard（纯函数，便于单测）。
//
// 玩家端旧逻辑只做内容 equality 短路、没有顺序保护：乱序/陈旧的共享快照（updatedAt 更旧）
// 会把玩家端状态回退。此 guard 给出统一判定：
//  - 同一 segment（如同一 combatId / 同一资源）下，updatedAt 严格更旧 ⇒ 丢弃（stale）。
//  - updatedAt 相等或更新，且内容确有变化 ⇒ 应用。
//  - 内容完全未变（snapshot 相等）⇒ 短路（无需 apply，但这不算「压制更新」，因为更新内容
//    一定让 snapshot 不同）。
//
// 关键不变量：equality 短路绝不会压制一个「合法更新」的 apply —— 更新意味着内容改变，
// 内容改变意味着 snapshot 字符串不同，于是不会命中短路。

export interface MonotonicState {
  lastUpdatedAt: number
  lastSnapshot: string
}

export interface MonotonicDecision {
  apply: boolean
  reason: 'stale' | 'unchanged' | 'apply'
  next: MonotonicState
}

export function decideApply(
  prev: MonotonicState,
  incomingUpdatedAt: number,
  incomingSnapshot: string,
): MonotonicDecision {
  if (incomingUpdatedAt < prev.lastUpdatedAt) {
    return { apply: false, reason: 'stale', next: prev }
  }
  if (incomingSnapshot === prev.lastSnapshot) {
    return { apply: false, reason: 'unchanged', next: prev }
  }
  return {
    apply: true,
    reason: 'apply',
    next: { lastUpdatedAt: incomingUpdatedAt, lastSnapshot: incomingSnapshot },
  }
}
