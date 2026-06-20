import { useEffect, useRef } from 'react'
// [T12/F2] HUD 自关闭时间纳入共享时序契约（结算窗口的一部分）。
import { DICE_TIMING } from '../lib/diceOverlayShared'

export interface D20AttackRoll {
  value: number
  modifier: number
  ac: number
  hit: boolean
  isCrit?: boolean
  /** attack: 命中判定；save: 豁免判定；dodge: 闪避判定 */
  kind?: 'attack' | 'dodge' | 'save'
}

export interface DiceRoll {
  values: number[]
  sides: number
  bonus: number
  total: number
  label: string
  formula?: string
  targetName: string
  /** 命中检定 d20（攻击/豁免等） */
  d20Roll?: D20AttackRoll
}

function formatRollBonus(bonus: number) {
  if (bonus > 0) return ` + ${bonus}`
  if (bonus < 0) return ` - ${Math.abs(bonus)}`
  return ''
}

/**
 * Result HUD card for a roll. The 3D dice animation is now rendered by the
 * threejs overlays (DiceBoxD20Overlay / DiceBoxRollOverlay); this component
 * only shows the authoritative result card.
 */
export default function DiceRollOverlay({ roll, onDone }: { roll: DiceRoll; onDone: () => void }) {
  const onDoneRef = useRef(onDone)

  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  const showDamage = roll.values.some((v) => v > 0) && roll.total > 0
  const d20 = roll.d20Roll

  useEffect(() => {
    const timer = window.setTimeout(() => onDoneRef.current(), DICE_TIMING.HUD_MS)
    return () => window.clearTimeout(timer)
  }, [roll])

  return (
    <div className="pointer-events-none absolute inset-0 z-50">
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-2xl border border-rose-400/40 bg-void-950/85 px-6 py-2 text-center shadow-2xl backdrop-blur-sm">
        <div className="text-xs text-slate-400">
          {roll.label} {'->'} {roll.targetName}
        </div>

        {d20 && (
          <div
            className={[
              'mt-1 text-sm font-bold tabular-nums',
              d20.kind === 'dodge'
                ? d20.hit
                  ? 'text-rose-300'
                  : 'text-emerald-300'
                : d20.hit
                  ? d20.isCrit
                    ? 'text-amber-300'
                    : 'text-sky-300'
                  : 'text-slate-500',
            ].join(' ')}
          >
            d20: {d20.value} + {d20.modifier} = {d20.value + d20.modifier} vs AC {d20.ac}
            {d20.kind === 'dodge'
              ? d20.hit
                ? ' · 攻击命中'
                : ' · 攻击未中（闪避成功）'
              : d20.kind === 'save'
                ? d20.hit
                  ? ' · 豁免成功'
                  : ' · 豁免失败'
                : d20.isCrit
                  ? ' · 重击！'
                  : d20.hit
                    ? ' · 命中'
                    : ' · 未中'}
          </div>
        )}
        {showDamage ? (
          <>
            <div className="text-[11px] text-slate-500">
              {roll.formula ?? `${roll.values.join(' + ')}${formatRollBonus(roll.bonus)} 总伤害`}
            </div>
            <div className="text-3xl font-black text-rose-300">{roll.total}</div>
          </>
        ) : d20 && !d20.hit ? (
          <div className="mt-1 text-lg font-bold text-slate-500">
            {d20.kind === 'dodge' ? '闪避成功 · 未受伤害' : '未造成伤害'}
          </div>
        ) : null}
      </div>
    </div>
  )
}
