/**
 * [T12/F3] 骰子 overlay 共享模块。
 *
 * `DiceBoxRollOverlay` 与 `DiceBoxD20Overlay` 原先各自复制了一份 `FLY_OFFSETS`、
 * FNV `stableIndex` 与 iframe 握手逻辑（飞行偏移解析 + 同源消息匹配）。这里收口为
 * 单一定义，两个 overlay 都从此导入，避免再次出现「改一处忘改另一处」的漂移。
 *
 * [T12/F2] 同时承载跨组件的时序契约常量（见下方 DICE_TIMING）。结算（overlay 可见
 * 窗口 + HUD 结果卡）必须先于回合推进发生；推进延迟由 advanceDelayMs() 派生为
 * ≥ max(overlay 可见窗口, HUD) + ε，而非各处魔数巧合相等。
 */

/** 骰子飞向屏幕四周的落点偏移（CSS 变量 --dice-fly-x / --dice-fly-y）。 */
export const FLY_OFFSETS = [
  ['-340px', '-120px'],
  ['340px', '-120px'],
  ['-360px', '80px'],
  ['360px', '80px'],
  ['-120px', '-260px'],
  ['120px', '-260px'],
  ['-220px', '240px'],
  ['220px', '240px'],
] as const

/** FNV-1a：把 requestId 稳定映射到 [0, length) 的桶索引（同一 id 永远同一落点）。 */
export function stableIndex(seed: string, length: number): number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % Math.max(1, length)
}

/**
 * 解析骰子飞行偏移：显式 flyIndex 优先（取模归一），否则用 requestId 经 FNV 稳定散列。
 * 返回 FLY_OFFSETS 中的一项 [x, y]。
 */
export function resolveFlyOffset(
  requestId: string,
  flyIndex?: number,
): readonly [string, string] {
  const idx =
    flyIndex == null
      ? stableIndex(requestId, FLY_OFFSETS.length)
      : Math.abs(Math.round(flyIndex)) % FLY_OFFSETS.length
  return FLY_OFFSETS[idx]
}

/** iframe 握手消息（同源校验后）的最小形状。 */
export interface DiceBoxMessage {
  type?: string
  requestId?: string
  stage?: string
  values?: unknown
  value?: unknown
}

/**
 * 共享握手：同源校验 + 解析 message data。返回 null 表示该消息应被忽略
 * （跨源、空 data，或调试 `dice-box-debug` 已就地打印）。两个 overlay 据此
 * 复用同一套「ready → send-roll → result」状态机骨架。
 */
export function parseDiceBoxMessage(event: MessageEvent): DiceBoxMessage | null {
  if (event.origin !== window.location.origin) return null
  const data = event.data as DiceBoxMessage | undefined
  if (!data) return null
  if (data.type === 'dice-box-debug') {
    console.info('[dice-box-debug]', data)
    return null
  }
  return data
}

/**
 * [T12/F2] 时序契约（毫秒）——所有骰子相关延迟的单一真相源。
 *
 * 不变式（ORDERING INVARIANT）：结算必须先于推进。
 *   RESOLUTION_MS = max(overlay 可见窗口, HUD 自关闭) —— 结果对玩家「定格」完成的时刻。
 *   ADVANCE_DELAY_MS ≥ RESOLUTION_MS + ADVANCE_EPSILON_MS —— 由构造保证 ≥ 结算，
 *   而不是靠两个魔数恰好相等。MapsPage 的回合推进延迟必须经 advanceDelayMs() 派生。
 */
export const DICE_TIMING = {
  /** DiceBoxRollOverlay 伤害骰最小可见窗口。 */
  ROLL_MIN_VISIBLE_MS: 2600,
  /** DiceBoxD20Overlay d20 最小可见窗口。 */
  D20_MIN_VISIBLE_MS: 2200,
  /** DiceRollOverlay 结果 HUD 卡自关闭时间。 */
  HUD_MS: 4000,
  /** 推进相对结算的安全余量。 */
  ADVANCE_EPSILON_MS: 200,
} as const

/** 结算窗口：overlay 可见窗口与 HUD 自关闭中的较大者。 */
export const RESOLUTION_MS = Math.max(
  DICE_TIMING.ROLL_MIN_VISIBLE_MS,
  DICE_TIMING.D20_MIN_VISIBLE_MS,
  DICE_TIMING.HUD_MS,
)

/**
 * 回合推进延迟，由构造保证 ≥ 结算窗口（不变式见 DICE_TIMING）。
 * 断言：advanceDelayMs() ≥ RESOLUTION_MS。
 */
export function advanceDelayMs(): number {
  return RESOLUTION_MS + DICE_TIMING.ADVANCE_EPSILON_MS
}
