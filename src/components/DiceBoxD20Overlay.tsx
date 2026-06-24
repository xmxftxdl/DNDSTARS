import { useEffect, useId, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
// [T12/F3] FLY_OFFSETS / stableIndex / 握手 / 时序常量收口到共享模块。
import { DICE_TIMING, parseDiceBoxMessage, resolveFlyOffset } from '../lib/diceOverlayShared'

const MIN_VISIBLE_ROLL_MS = DICE_TIMING.D20_MIN_VISIBLE_MS

interface DiceBoxD20OverlayProps {
  active?: boolean
  label: string
  targetName: string
  visualOnly?: boolean
  value?: number
  requestId?: string
  flyIndex?: number
  onComplete: (value: number) => void
}

function clampD20(value: unknown): number {
  const rounded = Math.round(Number(value))
  if (!Number.isFinite(rounded)) return 1 + Math.floor(Math.random() * 20)
  return Math.max(1, Math.min(20, rounded))
}

export default function DiceBoxD20Overlay({
  active = true,
  label: _label,
  targetName: _targetName,
  visualOnly = false,
  value,
  requestId: forcedRequestId,
  flyIndex,
  onComplete,
}: DiceBoxD20OverlayProps) {
  void _label
  void _targetName
  void visualOnly
  const rawId = useId()
  const generatedRequestId = `d20-${rawId}`
  const requestId = forcedRequestId ?? generatedRequestId
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const completedRef = useRef(false)
  const readyRef = useRef(false)
  const sentRequestRef = useRef<string | null>(null)
  const onCompleteRef = useRef(onComplete)
  const [flyX, flyY] = useMemo(() => resolveFlyOffset(requestId, flyIndex), [flyIndex, requestId])

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    if (!active) return
    completedRef.current = false
    const startedAt = Date.now()
    let cancelled = false
    const log = (stage: string, details?: Record<string, unknown>) => {
      console.info('[dice-box-d20-overlay]', {
        requestId,
        stage,
        elapsedMs: Date.now() - startedAt,
        forcedValue: value,
        ...details,
      })
    }
    const finish = (value: unknown) => {
      if (cancelled || completedRef.current) return
      completedRef.current = true
      const finalValue = clampD20(value)
      log('finish', { finalValue })
      const delay = Math.max(0, MIN_VISIBLE_ROLL_MS - (Date.now() - startedAt))
      window.setTimeout(() => {
        if (!cancelled) onCompleteRef.current(finalValue)
      }, delay)
    }
    const sendRoll = () => {
      if (sentRequestRef.current === requestId) return
      sentRequestRef.current = requestId
      log('send-roll')
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'roll-d20', requestId, value },
        window.location.origin,
      )
    }
    const timeout = window.setTimeout(() => {
      console.warn('DiceBox iframe D20 roll timed out; using fallback D20 roll')
      finish(value ?? 1 + Math.floor(Math.random() * 20))
    }, 22000)

    const handleMessage = (event: MessageEvent) => {
      const data = parseDiceBoxMessage(event)
      if (!data) return
      if (data?.type === 'dice-box-ready' && !readyRef.current) {
        readyRef.current = true
        log('iframe-ready')
        sendRoll()
        return
      }
      if (data?.type !== 'dice-box-d20-result' || data.requestId !== requestId) return
      log('result-message', { value: data.value })
      finish(value ?? data.value)
    }

    window.addEventListener('message', handleMessage)
    if (readyRef.current) {
      window.setTimeout(sendRoll, 0)
    }
    const retry = window.setTimeout(() => {
      if (!readyRef.current) {
        log('ready-retry-send')
        sendRoll()
      }
    }, 900)

    return () => {
      cancelled = true
      if (!completedRef.current && sentRequestRef.current === requestId) sentRequestRef.current = null
      window.clearTimeout(timeout)
      window.clearTimeout(retry)
      window.removeEventListener('message', handleMessage)
    }
  }, [active, requestId, value])

  return (
    <div className={`pointer-events-none absolute inset-0 z-[60] ${active ? '' : 'dice-box-d20-stage--idle'}`}>
      <iframe
        ref={iframeRef}
        title="D20 dice roller"
        src="/dice-box-frame.html"
        className="dice-box-d20-frame"
        style={{ '--dice-fly-x': flyX, '--dice-fly-y': flyY } as CSSProperties}
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  )
}
