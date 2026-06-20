import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DependencyList } from 'react'
import { Stage, Layer, Image as KonvaImage, Line, Group, Circle, Text, Rect, Arrow } from 'react-konva'
import Konva from 'konva'
import { getImage } from '../../lib/imageStore'
import {
  loadCalmMindIcon,
  loadDoubleArrowIcon,
  loadEagleEyeIcon,
  loadHuntingMarkIcon,
  loadIgniteIcon,
  loadKnockbackIcon,
  loadOutOfBreathIcon,
  loadPoisonIcon,
  loadPreciseStrikeIcon,
  loadSilentDrawIcon,
} from '../../lib/imageAlpha'
import {
  clampGridSize,
  cellKey,
  cellTopLeft,
  DEFAULT_GRID_COLOR,
  DEFAULT_GRID_OPACITY,
  DND_FEET_PER_CELL,
  gridStrokeRgba,
  measureSegmentCells,
  measureSnapsToGrid,
  resolveFreeDropCell,
  resolveTokenDropPosition,
  shouldSnapTokenOnDrop,
  snapToCellCenter,
  tokenDisplayRadius,
  TOKEN_MOVE_DURATION_S,
  type GridCell,
} from '../../lib/gridCombat'

const TOKEN_MOVE_DURATION = TOKEN_MOVE_DURATION_S
// [T8/AC5 · D5] 拖拽位移低于该像素阈值视为点击/抖动，不提交移动/广播。
const TOKEN_DRAG_THRESHOLD_PX = 4

// [T9/AC3 · D11] 状态特效动画统一节流帧率上限。
// 中毒(~19-23 径向渐变圆)/燃烧/眩晕等常驻动画原本以满 RAF(~60fps) 运行，多 token 叠加掉帧。
// 这些特效是慢速脉动/飘动，30fps 视觉上等效但 GPU/重绘开销约减半。
const STATUS_ANIM_FPS = 30

/**
 * [T9/AC3 · D11] 受控的 Konva 状态特效动画 Hook。
 * - active=false 时不启动动画（gate start/stop on 状态在场/可见性）；
 *   各状态特效组件本身已按 active 状态条件渲染，这里再显式 gate 一层，
 *   即使组件已挂载，只在 active 时驱动动画，clear 时立即 stop。
 * - 用 fps 上限节流回调：仅当距上次渲染 ≥ 1/fps 才执行 callback，
 *   但传入的 frame.time 仍是真实经过时间，因此节流不会冻结正在进行的特效，
 *   只是渲染得更稀疏（更省）。
 *
 * getLayer 在每帧由调用方提供节点取 layer（ref 在挂载后才有值）。
 */
function useStatusAnimation(
  getLayer: () => Konva.Layer | null,
  callback: (frame: { time: number } | null) => void,
  deps: DependencyList,
  options?: { active?: boolean; fps?: number },
) {
  const active = options?.active ?? true
  const fps = options?.fps ?? STATUS_ANIM_FPS
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!active) return
    const minDelta = fps > 0 ? 1000 / fps : 0
    let lastRender = -Infinity
    let anim: Konva.Animation | null = null
    let raf = 0

    const start = () => {
      const layer = getLayer()
      if (!layer) {
        // layer 尚未挂载（ref 在首帧可能为空），下一帧重试。
        raf = requestAnimationFrame(start)
        return
      }
      anim = new Konva.Animation((frame) => {
        const time = frame?.time ?? 0
        // 节流：未到帧预算则跳过本次重绘（frame.time 仍为真实时间，特效不冻结）。
        if (minDelta > 0 && time - lastRender < minDelta) return
        lastRender = time
        callbackRef.current(frame ? { time: frame.time } : null)
      }, layer)
      anim.start()
    }

    start()
    return () => {
      cancelAnimationFrame(raf)
      anim?.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, fps, ...deps])
}

import { useMapStore } from '../../store/maps'
import type { BattleMap, Token } from '../../store/maps'

export interface MoveCircle {
  centerX: number
  centerY: number
  radiusPx: number
}

export interface AoeHighlight {
  cells: GridCell[]
  rangeCells?: GridCell[]
  valid: boolean
  /** 深红色原始范围轮廓（圆形） */
  areaCircle?: {
    centerX: number
    centerY: number
    radiusPx: number
  }
  /** 深红色原始范围轮廓（矩形/直线） */
  areaPolygon?: number[]
  /** range：蓝色可选区；attack：黄色受击区 */
  variant?: 'attack' | 'range'
}

export interface MapProjectile {
  id: string
  from: { x: number; y: number }
  to: { x: number; y: number }
  kind?: 'arrow' | 'focus'
}

export interface DeleteSelectionRect {
  x: number
  y: number
  width: number
  height: number
}

interface MapCanvasProps {
  map: BattleMap
  selectedTokenId: string | null
  onSelectToken: (id: string | null) => void
  measureMode?: boolean
  /** 每个 token 的生命值（用于显示血条） */
  hpByToken?: Record<string, { hp: number; max: number; temp?: number }>
  /** 玩家移动：以 token 为圆心、半径为尺数的圆 */
  moveSelectMode?: boolean
  moveCircle?: MoveCircle
  onMoveSelect?: (point: { x: number; y: number }) => void
  /** 圆形 AOE 选区：高亮格子 + 点击确认 */
  aoeSelectMode?: boolean
  aoeHighlight?: AoeHighlight
  rangedRangeCells?: GridCell[]
  onAoePreviewCell?: (cell: GridCell | null) => void
  onAoeConfirm?: (cell: GridCell) => void
  onAoeCancel?: () => void
  /** tokenId → 地图 token 上的状态角标 */
  tokenBadges?: Record<
    string,
    {
      doubleArrow?: boolean
      eagleEye?: boolean
      silentDraw?: boolean
      preciseStrike?: boolean
      calmMind?: boolean
      calmSpiritStacks?: number
      outOfBreath?: boolean
      huntingMarkStacks?: number
    }
  >
  tokenHoverLabels?: Record<string, string>
  projectiles?: MapProjectile[]
  /** 已阵亡 token（灰显） */
  defeatedTokenIds?: string[]
  /** 战斗中禁止拖动的 token */
  lockDragTokenIds?: string[]
  /** 底图自带网格，token 尺寸贴合格子 */
  builtinGrid?: boolean
  /** DM：拖拽平移网格对齐底图 */
  gridAdjustMode?: boolean
  onGridOffsetChange?: (offsetX: number, offsetY: number) => void
  /** 调节格子大小时临时显示网格 */
  gridSizePreview?: boolean
  onGridSizeChange?: (gridSize: number) => void
  onBlankContextMenu?: () => void
  deleteSelectMode?: boolean
  onDeleteBoxConfirm?: (rect: DeleteSelectionRect) => void
  onDeleteCancel?: () => void
  /** DM 视角：始终显示敌人血量条；玩家视角受 token.showHpOnToken 控制 */
  isDM?: boolean
}

interface Point {
  x: number
  y: number
}

function rectFromPoints(a: Point, b: Point): DeleteSelectionRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

function measurePointsEqual(a: Point, b: Point): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) < 1.5
}

function isMapTokenNode(node: Konva.Node | null): boolean {
  let n: Konva.Node | null = node
  while (n) {
    if (n.name() === 'map-token') return true
    n = n.parent
  }
  return false
}

/** 网格线位置：offset + n·step，覆盖 [0, length] */
function gridLinePositions(length: number, offset: number, step: number): number[] {
  if (step <= 0) return []
  const positions: number[] = []
  const nMin = Math.ceil((0 - offset) / step)
  const nMax = Math.floor((length - offset) / step)
  for (let n = nMin; n <= nMax; n++) {
    const p = offset + n * step
    if (p >= 0 && p <= length) positions.push(p)
  }
  return positions
}

/** Token 右上缘角标：锚在圆环 1~2 点方向，向右排，每行最多 3 个 */
const DOUBLE_ARROW_BADGE_RATIO = 0.4
const RIGHT_BADGE_MAX_COLS = 3
/** 首个角标中心：贴近 Token 右上边框（红圈标注位） */
const RIGHT_BADGE_ANCHOR_X_RATIO = 0.56
const RIGHT_BADGE_ANCHOR_Y_RATIO = -0.84

function tokenScale(radius: number): number {
  return Math.max(0.35, Math.min(1, radius / 24))
}

function tokenLineWidth(radius: number, px: number): number {
  return Math.max(0.5, px * tokenScale(radius))
}

function tokenDash(radius: number, dash: number[]): number[] {
  const scale = tokenScale(radius)
  return dash.map((value) => Math.max(1, value * scale))
}

function rightBadgeSize(radius: number): number {
  return Math.max(8, radius * 2 * DOUBLE_ARROW_BADGE_RATIO)
}

function rightBadgeGridPos(radius: number, size: number, gridIndex: number): { x: number; y: number } {
  const col = gridIndex % RIGHT_BADGE_MAX_COLS
  const row = Math.floor(gridIndex / RIGHT_BADGE_MAX_COLS)
  const gap = Math.max(1, size * 0.02)
  const anchorX = radius * RIGHT_BADGE_ANCHOR_X_RATIO
  const anchorY = radius * RIGHT_BADGE_ANCHOR_Y_RATIO
  return {
    x: anchorX + col * (size + gap),
    y: anchorY + row * (size + gap),
  }
}

function DoubleArrowBadge({ radius, gridIndex = 0 }: { radius: number; gridIndex?: number }) {
  const [iconCanvas, setIconCanvas] = useState<HTMLCanvasElement | null>(null)
  const size = rightBadgeSize(radius)
  const r = size / 2
  const { x, y } = rightBadgeGridPos(radius, size, gridIndex)
  const fallbackStrokeW = tokenLineWidth(radius, 1.5)

  useEffect(() => {
    let cancelled = false
    loadDoubleArrowIcon().then((c) => {
      if (!cancelled) setIconCanvas(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Group x={x} y={y} listening={false}>
      {iconCanvas ? (
        <KonvaImage
          image={iconCanvas}
          width={size}
          height={size}
          offsetX={r}
          offsetY={r}
          x={0}
          y={0}
          shadowBlur={4 * tokenScale(radius)}
          shadowColor="rgba(34,197,94,0.55)"
        />
      ) : (
        <>
          <Circle
            radius={r}
            fill="rgba(5,46,22,0.18)"
            stroke="#22c55e"
            strokeWidth={fallbackStrokeW}
          />
          <Text
            text="×2"
            fontSize={Math.max(9, r * 0.95)}
            fill="#bbf7d0"
            fontStyle="bold"
            align="center"
            verticalAlign="middle"
            width={size}
            height={size}
            offsetX={r}
            offsetY={r}
          />
        </>
      )}
    </Group>
  )
}

function AoeCellHighlights({
  map,
  cells,
  valid,
  variant = 'attack',
}: {
  map: BattleMap
  cells: GridCell[]
  valid: boolean
  variant?: 'attack' | 'range'
}) {
  const g = Math.max(1, map.gridSize)
  const fill =
    variant === 'range'
      ? valid
        ? 'rgba(59, 130, 246, 0.42)'
        : 'rgba(100, 116, 139, 0.28)'
      : valid
        ? 'rgba(245, 158, 11, 0.42)'
        : 'rgba(100, 116, 139, 0.28)'
  const stroke =
    variant === 'range'
      ? valid
        ? 'rgba(96, 165, 250, 0.75)'
        : 'rgba(148, 163, 184, 0.55)'
      : valid
        ? 'rgba(251, 191, 36, 0.9)'
        : 'rgba(148, 163, 184, 0.55)'
  return (
    <>
      {cells.map((cell) => {
        const { x, y } = cellTopLeft(cell, map)
        return (
          <Rect
            key={cellKey(cell)}
            x={x}
            y={y}
            width={g}
            height={g}
            fill={fill}
            stroke={stroke}
            strokeWidth={2}
            listening={false}
          />
        )
      })}
    </>
  )
}

const IGNITE_RING_COLOR = '#dc2626'
const KNOCKBACK_RING_COLOR = '#2563eb'
const POISON_RING_COLOR = '#22c55e'
const EAGLE_EYE_RING_COLOR = '#0ea5e9'
const CALM_MIND_RING_COLOR = '#14b8a6'
const OUT_OF_BREATH_RING_COLOR = '#f97316'
const HUNTING_MARK_RING_COLOR = '#f59e0b'

/** 状态角标：Konva 绘制加粗描边，裁剪 PNG 外缘白晕 */
function RingedStatusIconBadge({
  radius,
  gridIndex = 0,
  iconCanvas,
  ringColor,
  backgroundFill = '#ffffff',
}: {
  radius: number
  gridIndex?: number
  iconCanvas: HTMLCanvasElement
  ringColor: string
  backgroundFill?: string
}) {
  const size = rightBadgeSize(radius)
  const { x, y } = rightBadgeGridPos(radius, size, gridIndex)
  const r = size / 2
  const strokeW = tokenLineWidth(radius, 1.5)
  const innerR = Math.max(1, r - strokeW / 2 - 0.5)

  return (
    <Group x={x} y={y} listening={false}>
      <Group
        clipFunc={(ctx) => {
          ctx.beginPath()
          ctx.arc(0, 0, innerR, 0, Math.PI * 2)
          ctx.closePath()
        }}
        listening={false}
      >
        <Circle radius={innerR} fill={backgroundFill} listening={false} />
        <KonvaImage
          image={iconCanvas}
          width={size}
          height={size}
          offsetX={size / 2}
          offsetY={size / 2}
          imageSmoothingEnabled={false}
          listening={false}
        />
      </Group>
      <Circle
        radius={r - strokeW / 2}
        stroke={ringColor}
        strokeWidth={strokeW}
        fillEnabled={false}
        perfectDrawEnabled={false}
        shadowForStrokeEnabled={false}
        listening={false}
      />
    </Group>
  )
}

/** 点燃角标（燃烧/点燃共用：红圈火焰图） */
function IgniteBadge({ radius, gridIndex = 0 }: { radius: number; gridIndex?: number }) {
  const [iconCanvas, setIconCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    loadIgniteIcon().then((c) => {
      if (!cancelled) setIconCanvas(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!iconCanvas) return null

  return (
    <RingedStatusIconBadge
      radius={radius}
      gridIndex={gridIndex}
      iconCanvas={iconCanvas}
      ringColor={IGNITE_RING_COLOR}
    />
  )
}

/** 鹰眼角标（激活时显示） */
function EagleEyeBadge({ radius, gridIndex = 0 }: { radius: number; gridIndex?: number }) {
  const [iconCanvas, setIconCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    loadEagleEyeIcon().then((c) => {
      if (!cancelled) setIconCanvas(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!iconCanvas) return null

  return (
    <RingedStatusIconBadge
      radius={radius}
      gridIndex={gridIndex}
      iconCanvas={iconCanvas}
      ringColor={EAGLE_EYE_RING_COLOR}
    />
  )
}

/** 中毒角标 */
function PoisonBadge({ radius, gridIndex = 0 }: { radius: number; gridIndex?: number }) {
  const [iconCanvas, setIconCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    loadPoisonIcon().then((c) => {
      if (!cancelled) setIconCanvas(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!iconCanvas) return null

  return (
    <RingedStatusIconBadge
      radius={radius}
      gridIndex={gridIndex}
      iconCanvas={iconCanvas}
      ringColor={POISON_RING_COLOR}
    />
  )
}

/** 击飞角标 */
function KnockbackBadge({ radius, gridIndex = 0 }: { radius: number; gridIndex?: number }) {
  const [iconCanvas, setIconCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    loadKnockbackIcon().then((c) => {
      if (!cancelled) setIconCanvas(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!iconCanvas) return null

  return (
    <RingedStatusIconBadge
      radius={radius}
      gridIndex={gridIndex}
      iconCanvas={iconCanvas}
      ringColor={KNOCKBACK_RING_COLOR}
    />
  )
}

function HuntingMarkBadge({
  radius,
  gridIndex = 0,
}: {
  radius: number
  gridIndex?: number
}) {
  const [iconCanvas, setIconCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    loadHuntingMarkIcon().then((c) => {
      if (!cancelled) setIconCanvas(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!iconCanvas) return null

  return (
    <RingedStatusIconBadge
      radius={radius}
      gridIndex={gridIndex}
      iconCanvas={iconCanvas}
      ringColor={HUNTING_MARK_RING_COLOR}
    />
  )
}

function BadgeCornerNumber({
  radius,
  gridIndex = 0,
  text,
  stroke,
}: {
  radius: number
  gridIndex?: number
  text: string
  stroke: string
}) {
  const size = rightBadgeSize(radius)
  const { x, y } = rightBadgeGridPos(radius, size, gridIndex)
  const r = size / 2
  const nr = Math.max(6, r * 0.42)
  return (
    <Group x={x + r * 0.55} y={y + r * 0.55} listening={false}>
      <Text
        text={text}
        width={nr * 2}
        height={nr * 2}
        offsetX={nr}
        offsetY={nr}
        fontSize={Math.max(8, nr * 1.25)}
        fontStyle="bold"
        fill="#ef4444"
        stroke={stroke}
        strokeWidth={Math.max(0.35, tokenLineWidth(radius, 0.38))}
        shadowBlur={3 * tokenScale(radius)}
        shadowColor="rgba(0,0,0,0.85)"
        align="center"
        verticalAlign="middle"
      />
    </Group>
  )
}

function SilentDrawBadge({ radius, gridIndex = 0 }: { radius: number; gridIndex?: number }) {
  const [iconCanvas, setIconCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    loadSilentDrawIcon().then((c) => {
      if (!cancelled) setIconCanvas(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!iconCanvas) return null

  return (
    <RingedStatusIconBadge
      radius={radius}
      gridIndex={gridIndex}
      iconCanvas={iconCanvas}
      ringColor="#a78bfa"
    />
  )
}

function PreciseStrikeBadge({ radius, gridIndex = 0 }: { radius: number; gridIndex?: number }) {
  const [iconCanvas, setIconCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    loadPreciseStrikeIcon().then((c) => {
      if (!cancelled) setIconCanvas(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!iconCanvas) return null

  return (
    <RingedStatusIconBadge
      radius={radius}
      gridIndex={gridIndex}
      iconCanvas={iconCanvas}
      ringColor="#fb7185"
      backgroundFill="#2a0508"
    />
  )
}

/** 静心角标 */
function CalmMindBadge({ radius, gridIndex = 0 }: { radius: number; gridIndex?: number }) {
  const [iconCanvas, setIconCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    loadCalmMindIcon().then((c) => {
      if (!cancelled) setIconCanvas(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!iconCanvas) return null

  return (
    <RingedStatusIconBadge
      radius={radius}
      gridIndex={gridIndex}
      iconCanvas={iconCanvas}
      ringColor={CALM_MIND_RING_COLOR}
    />
  )
}

/** 气喘角标 */
function OutOfBreathBadge({ radius, gridIndex = 0 }: { radius: number; gridIndex?: number }) {
  const [iconCanvas, setIconCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    loadOutOfBreathIcon().then((c) => {
      if (!cancelled) setIconCanvas(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!iconCanvas) return null

  return (
    <RingedStatusIconBadge
      radius={radius}
      gridIndex={gridIndex}
      iconCanvas={iconCanvas}
      ringColor={OUT_OF_BREATH_RING_COLOR}
    />
  )
}

export default function MapCanvas({
  map,
  selectedTokenId,
  onSelectToken,
  measureMode = false,
  hpByToken,
  moveSelectMode = false,
  moveCircle,
  onMoveSelect,
  aoeSelectMode = false,
  aoeHighlight,
  rangedRangeCells = [],
  onAoePreviewCell,
  onAoeConfirm,
  onAoeCancel,
  tokenBadges = {},
  tokenHoverLabels = {},
  projectiles = [],
  defeatedTokenIds = [],
  lockDragTokenIds = [],
  builtinGrid = false,
  gridAdjustMode = false,
  onGridOffsetChange,
  gridSizePreview = false,
  onGridSizeChange,
  onBlankContextMenu,
  deleteSelectMode = false,
  onDeleteBoxConfirm,
  onDeleteCancel,
  isDM = false,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gridDragRef = useRef<{
    startX: number
    startY: number
    origOx: number
    origOy: number
  } | null>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [image, setImage] = useState<HTMLImageElement | undefined>(undefined)
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [hoveredTokenId, setHoveredTokenId] = useState<string | null>(null)
  const [dragPreviewPositions, setDragPreviewPositions] = useState<Record<string, Point>>({})
  const [deleteDrag, setDeleteDrag] = useState<{ start: Point; current: Point } | null>(null)
  const fittedRef = useRef(false)

  // 测距状态（图片坐标）：已确定的线段 + 正在放置的起点/光标
  const [segments, setSegments] = useState<{ a: Point; b: Point }[]>([])
  const [pending, setPending] = useState<Point | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)

  const updateToken = useMapStore((s) => s.updateToken)

  const displayToken = (token: Token): Token => {
    const preview = dragPreviewPositions[token.id]
    return preview ? { ...token, x: preview.x, y: preview.y } : token
  }

  // 退出测距模式时清除全部测量线
  useEffect(() => {
    if (!measureMode) {
      setSegments([])
      setPending(null)
      setCursor(null)
    }
  }, [measureMode])

  useEffect(() => {
    if (!deleteSelectMode) setDeleteDrag(null)
  }, [deleteSelectMode])

  // 网格对齐：方向键微调
  useEffect(() => {
    if (!gridAdjustMode || !onGridOffsetChange) return
    const onKey = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 5 : 1
      let ox = map.gridOffsetX
      let oy = map.gridOffsetY
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        ox -= step
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        ox += step
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        oy -= step
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        oy += step
      } else if (e.key === 'Escape') {
        return
      } else {
        return
      }
      onGridOffsetChange(ox, oy)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gridAdjustMode, map.gridOffsetX, map.gridOffsetY, onGridOffsetChange])

  // 网格对齐：拖拽平移（全局监听松开）
  useEffect(() => {
    if (!gridAdjustMode) {
      gridDragRef.current = null
      return
    }
    const endDrag = () => {
      gridDragRef.current = null
    }
    window.addEventListener('mouseup', endDrag)
    window.addEventListener('touchend', endDrag)
    return () => {
      window.removeEventListener('mouseup', endDrag)
      window.removeEventListener('touchend', endDrag)
    }
  }, [gridAdjustMode])

  // 键盘：Backspace 删除（优先取消正在放置的，否则删最后一段）
  useEffect(() => {
    if (!measureMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        if (pending) {
          setPending(null)
          setCursor(null)
        } else {
          setSegments((segs) => segs.slice(0, -1))
        }
      } else if (e.key === 'Escape') {
        setPending(null)
        setCursor(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [measureMode, pending])

  const relativePoint = (stage: Konva.Stage | null): Point | null => {
    if (!stage) return null
    const p = stage.getRelativePointerPosition()
    return p ? { x: p.x, y: p.y } : null
  }

  const gridPoint = (p: Point): GridCell => ({
    col: (p.x - map.gridOffsetX) / map.gridSize - 0.5,
    row: (p.y - map.gridOffsetY) / map.gridSize - 0.5,
  })

  const snapMeasure = measureSnapsToGrid(map)
  const segmentCells = (a: Point, b: Point): number =>
    measureSegmentCells(a, b, map, snapMeasure)

  const measurePoint = (raw: Point): Point =>
    snapMeasure ? snapToCellCenter(raw.x, raw.y, map) : raw

  // 从 IndexedDB 取图片
  // 单一所有者：本 effect 独占管理 blob URL 的创建/解码/释放，
  // 不再由 useImage 与手动 createObjectURL 双重托管同一 URL（避免快速切图时的撕裂/闪烁）。
  // URL 在图片 onload（解码完成、不再需要 URL）后立即 revoke；
  // 切图/卸载时若尚未解码，则在 cleanup 中取消加载并 revoke，杜绝泄漏。
  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    let img: HTMLImageElement | null = null
    getImage(map.id).then((blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob)
      img = new window.Image()
      img.onload = () => {
        if (cancelled) return
        setImage(img ?? undefined)
        // 解码完成后 URL 已不再需要，立即释放。
        URL.revokeObjectURL(objectUrl)
        objectUrl = ''
      }
      img.onerror = () => {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl)
          objectUrl = ''
        }
      }
      img.src = objectUrl
    })
    return () => {
      cancelled = true
      if (img) {
        img.onload = null
        img.onerror = null
      }
      // 若图片尚未解码（onload 未触发），cleanup 仍需 revoke 以防泄漏。
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
        objectUrl = ''
      }
    }
  }, [map.id])

  // 监听容器尺寸
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // [T8/AC6 · D6] 切换地图时重置 fitted 标记，使新地图进入时自适应一次。
  // 不用 key={map.id} 重挂载（会撕裂 Konva.Animation 实例、拖拽预览、视图/缩放、hover/测距状态）。
  useEffect(() => {
    fittedRef.current = false
  }, [map.id])

  // 首次加载时自适应缩放使整张图可见（每张地图进入时各自适应一次，由上面的 effect 重置 fittedRef）
  useEffect(() => {
    if (!image || fittedRef.current || size.width === 0) return
    const scale = Math.min(size.width / map.width, size.height / map.height) * 0.95
    setView({
      scale,
      x: (size.width - map.width * scale) / 2,
      y: (size.height - map.height * scale) / 2,
    })
    fittedRef.current = true
  }, [image, size, map.width, map.height])

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    if (gridAdjustMode && onGridSizeChange) {
      e.evt.preventDefault()
      const step = e.evt.shiftKey ? 3 : 1
      const delta = e.evt.deltaY > 0 ? -step : step
      onGridSizeChange(clampGridSize(map.gridSize + delta, map))
      return
    }
    e.evt.preventDefault()
    const stage = e.target.getStage()
    if (!stage) return
    const oldScale = view.scale
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const mousePointTo = {
      x: (pointer.x - view.x) / oldScale,
      y: (pointer.y - view.y) / oldScale,
    }
    const direction = e.evt.deltaY > 0 ? -1 : 1
    const newScale = Math.max(0.1, Math.min(4, direction > 0 ? oldScale * 1.08 : oldScale / 1.08))
    setView({
      scale: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    })
  }

  const showGridOverlay = (map.showGrid || gridAdjustMode || gridSizePreview) && map.gridSize > 0
  const gridHex = map.gridColor ?? DEFAULT_GRID_COLOR
  const gridAlpha = map.gridOpacity ?? DEFAULT_GRID_OPACITY
  const gridStroke = gridAdjustMode
    ? 'rgba(251,191,36,0.62)'
    : gridSizePreview
      ? gridStrokeRgba(gridHex, Math.min(0.85, gridAlpha + 0.22))
      : gridStrokeRgba(gridHex, gridAlpha)
  const gridLines: React.ReactNode[] = []
  const coordinateLabels: React.ReactNode[] = []
  if (showGridOverlay) {
    const g = map.gridSize
    for (const x of gridLinePositions(map.width, map.gridOffsetX, g)) {
      gridLines.push(
        <Line
          key={`v${x}`}
          points={[x, 0, x, map.height]}
          stroke={gridStroke}
          strokeWidth={gridAdjustMode ? 1.5 : 1}
          listening={false}
        />,
      )
    }
    for (const y of gridLinePositions(map.height, map.gridOffsetY, g)) {
      gridLines.push(
        <Line
          key={`h${y}`}
          points={[0, y, map.width, y]}
          stroke={gridStroke}
          strokeWidth={gridAdjustMode ? 1.5 : 1}
          listening={false}
        />,
      )
    }
    if (map.showCoordinates !== false) {
      const labelStep = g >= 36 ? 1 : g >= 18 ? 2 : 5
      const minCol = Math.ceil((0 - map.gridOffsetX) / g)
      const maxCol = Math.floor((map.width - map.gridOffsetX) / g)
      const minRow = Math.ceil((0 - map.gridOffsetY) / g)
      const maxRow = Math.floor((map.height - map.gridOffsetY) / g)
      const fontSize = Math.max(10, Math.min(14, g * 0.2))
      const labelFill = 'rgba(226, 232, 240, 0.88)'
      const labelBg = 'rgba(15, 23, 42, 0.68)'
      for (let col = minCol; col < maxCol; col++) {
        if (Math.abs(col) % labelStep !== 0) continue
        const x = map.gridOffsetX + (col + 0.5) * g
        if (x < 0 || x > map.width) continue
        coordinateLabels.push(
          <Group key={`x-label-${col}`} x={x} y={Math.max(2, map.gridOffsetY + 2)} listening={false}>
            <Rect x={-12} y={0} width={24} height={fontSize + 6} cornerRadius={4} fill={labelBg} />
            <Text
              x={-12}
              y={3}
              width={24}
              text={`${col}`}
              align="center"
              fontSize={fontSize}
              fontStyle="bold"
              fill={labelFill}
            />
          </Group>,
        )
      }
      for (let row = minRow; row < maxRow; row++) {
        if (Math.abs(row) % labelStep !== 0) continue
        const y = map.gridOffsetY + (row + 0.5) * g
        if (y < 0 || y > map.height) continue
        coordinateLabels.push(
          <Group key={`y-label-${row}`} x={Math.max(2, map.gridOffsetX + 2)} y={y} listening={false}>
            <Rect x={0} y={-10} width={26} height={20} cornerRadius={4} fill={labelBg} />
            <Text
              x={0}
              y={-fontSize / 2}
              width={26}
              text={`${row}`}
              align="center"
              fontSize={fontSize}
              fontStyle="bold"
              fill={labelFill}
            />
          </Group>,
        )
      }
    }
    if (gridAdjustMode) {
      gridLines.push(
        <Circle
          key="grid-origin"
          x={map.gridOffsetX}
          y={map.gridOffsetY}
          radius={5}
          fill="rgba(251,191,36,0.9)"
          stroke="#fff"
          strokeWidth={1}
          listening={false}
        />,
      )
    }
  }

  const inv = 1 / view.scale // 让线宽/文字不随缩放变化

  return (
    <div
      ref={containerRef}
      className={`h-full w-full overflow-hidden rounded-2xl bg-void-900/60 ${
        gridAdjustMode
          ? 'cursor-move'
          : measureMode
            ? 'cursor-crosshair'
            : aoeSelectMode
              ? 'cursor-crosshair'
              : deleteSelectMode
                ? 'cursor-crosshair'
                : moveSelectMode
                  ? 'cursor-cell'
                  : ''
      }`}
    >
      <Stage
        width={size.width}
        height={size.height}
        scaleX={view.scale}
        scaleY={view.scale}
        x={view.x}
        y={view.y}
        draggable={!measureMode && !moveSelectMode && !aoeSelectMode && !gridAdjustMode && !deleteSelectMode}
        onWheel={handleWheel}
        onDragEnd={(e) => {
          // 仅当拖动的是舞台本身（平移）时更新视图
          if (e.target === e.target.getStage()) {
            setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }))
          }
        }}
        onContextMenu={(e) => {
          // 屏蔽浏览器右键菜单；测距时右键取消正在放置的起点
          e.evt.preventDefault()
          if (deleteSelectMode) {
            setDeleteDrag(null)
            onDeleteCancel?.()
            return
          }
          if (aoeSelectMode) {
            onAoeCancel?.()
            return
          }
          if (measureMode && pending) {
            setPending(null)
            setCursor(null)
            return
          }
          if (!isMapTokenNode(e.target)) {
            onBlankContextMenu?.()
          }
        }}
        onMouseDown={(e) => {
          const stage = e.target.getStage()
          if (deleteSelectMode && e.evt.button === 0) {
            e.cancelBubble = true
            const p = relativePoint(stage)
            if (p) setDeleteDrag({ start: p, current: p })
            return
          }
          if (aoeSelectMode && e.evt.button === 0) {
            e.cancelBubble = true
            const p = relativePoint(stage)
            if (p) {
              onAoeConfirm?.(gridPoint(p))
            }
            return
          }
          if (moveSelectMode && moveCircle && e.evt.button === 0 && !isMapTokenNode(e.target)) {
            const p = relativePoint(stage)
            if (p) onMoveSelect?.(p)
            return
          }
          if (measureMode) {
            if (e.evt.button !== 0) return // 仅左键放点
            const raw = relativePoint(stage)
            if (!raw) return
            const p = measurePoint(raw)
            if (!pending) {
              setPending(p)
              setCursor(p)
            } else {
              if (!measurePointsEqual(pending, p)) {
                setSegments((segs) => [...segs, { a: pending, b: p }])
              }
              setPending(null)
              setCursor(null)
            }
            return
          }
          if (gridAdjustMode && onGridOffsetChange && e.evt.button === 0 && !isMapTokenNode(e.target)) {
            const p = relativePoint(stage)
            if (!p) return
            gridDragRef.current = {
              startX: p.x,
              startY: p.y,
              origOx: map.gridOffsetX,
              origOy: map.gridOffsetY,
            }
            return
          }
          if (!isMapTokenNode(e.target)) onSelectToken(null)
        }}
        onMouseMove={(e) => {
          if (deleteSelectMode && deleteDrag) {
            const p = relativePoint(e.target.getStage())
            if (p) setDeleteDrag((drag) => (drag ? { ...drag, current: p } : drag))
            return
          }
          if (aoeSelectMode && onAoePreviewCell) {
            const p = relativePoint(e.target.getStage())
            if (p) onAoePreviewCell(gridPoint(p))
            return
          }
          if (gridAdjustMode && gridDragRef.current && onGridOffsetChange) {
            const p = relativePoint(e.target.getStage())
            if (!p) return
            const d = gridDragRef.current
            onGridOffsetChange(
              Math.round(d.origOx + (p.x - d.startX)),
              Math.round(d.origOy + (p.y - d.startY)),
            )
            return
          }
          if (measureMode && pending) {
            const raw = relativePoint(e.target.getStage())
            if (raw) setCursor(measurePoint(raw))
          }
        }}
        onMouseUp={(e) => {
          if (!deleteSelectMode || !deleteDrag) return
          e.cancelBubble = true
          const p = relativePoint(e.target.getStage()) ?? deleteDrag.current
          const rect = rectFromPoints(deleteDrag.start, p)
          setDeleteDrag(null)
          if (rect.width >= 4 && rect.height >= 4) onDeleteBoxConfirm?.(rect)
        }}
      >
        <Layer>
          {image && <KonvaImage image={image} width={map.width} height={map.height} />}
          {gridLines}
          {coordinateLabels}
          {aoeSelectMode && aoeHighlight?.areaCircle && (
            <Circle
              x={aoeHighlight.areaCircle.centerX}
              y={aoeHighlight.areaCircle.centerY}
              radius={aoeHighlight.areaCircle.radiusPx}
              fill="rgba(127, 29, 29, 0.12)"
              stroke="rgba(185, 28, 28, 0.9)"
              strokeWidth={3}
              dash={[12, 7]}
              listening={false}
            />
          )}
          {aoeSelectMode && aoeHighlight?.areaPolygon && (
            <Line
              points={aoeHighlight.areaPolygon}
              closed
              fill="rgba(127, 29, 29, 0.12)"
              stroke="rgba(185, 28, 28, 0.9)"
              strokeWidth={3}
              dash={[12, 7]}
              listening={false}
            />
          )}
          {aoeSelectMode && aoeHighlight?.rangeCells && aoeHighlight.rangeCells.length > 0 && (
            <AoeCellHighlights
              map={map}
              cells={aoeHighlight.rangeCells}
              valid={aoeHighlight.valid}
              variant="range"
            />
          )}
          {aoeSelectMode && aoeHighlight && aoeHighlight.cells.length > 0 && (
            <AoeCellHighlights
              map={map}
              cells={aoeHighlight.cells}
              valid={aoeHighlight.valid}
              variant="attack"
            />
          )}
          {!aoeSelectMode && rangedRangeCells.length > 0 && (
            <AoeCellHighlights
              map={map}
              cells={rangedRangeCells}
              valid
              variant="range"
            />
          )}
          {moveSelectMode && moveCircle && (
            <Circle
              x={moveCircle.centerX}
              y={moveCircle.centerY}
              radius={moveCircle.radiusPx}
              fill="rgba(56, 189, 248, 0.1)"
              stroke="rgba(125, 211, 252, 0.45)"
              strokeWidth={2}
              dash={[10, 8]}
              listening
              onMouseDown={(e) => {
                e.cancelBubble = true
                const st = e.target.getStage()
                const p = relativePoint(st)
                if (p) onMoveSelect?.(p)
              }}
            />
          )}
          {map.tokens.map((t) => {
            const hp = hpByToken?.[t.id]
            const defeated = hp != null ? hp.hp <= 0 : defeatedTokenIds.includes(t.id)
            return (
            <TokenNode
              key={`body-${t.id}`}
              renderMode="body"
              token={t}
              gridSize={map.gridSize}
              builtinGrid={builtinGrid}
              selected={t.id === selectedTokenId}
              defeated={defeated}
              draggable={
                isDM &&
                !measureMode &&
                !deleteSelectMode &&
                !gridAdjustMode &&
                !lockDragTokenIds.includes(t.id)
              }
              hp={hpByToken?.[t.id]}
              showHpBar={
                !!hpByToken?.[t.id] &&
                (isDM || !!t.characterId || t.showHpOnToken !== false)
              }
              doubleArrowBadge={tokenBadges[t.id]?.doubleArrow}
              eagleEyeBadge={tokenBadges[t.id]?.eagleEye}
              silentDrawBadge={tokenBadges[t.id]?.silentDraw}
              preciseStrikeBadge={tokenBadges[t.id]?.preciseStrike}
              calmMindBadge={tokenBadges[t.id]?.calmMind}
              calmSpiritStacks={tokenBadges[t.id]?.calmSpiritStacks}
              outOfBreathBadge={tokenBadges[t.id]?.outOfBreath}
              huntingMarkStacks={tokenBadges[t.id]?.huntingMarkStacks}
              hoverLabel={hoveredTokenId === t.id ? tokenHoverLabels[t.id] : undefined}
              onHoverChange={(hovered) =>
                // [T8/AC7 · D7] 统一为函数式更新，避免布尔 + 函数式混用导致的悬停闪烁竞态。
                setHoveredTokenId((id) => (hovered ? t.id : id === t.id ? null : id))
              }
              onSelect={() => {
                if (aoeSelectMode || deleteSelectMode) return
                onSelectToken(t.id)
              }}
              onDragEnd={(x, y) => {
                const snapped = resolveTokenDropPosition(x, y, t, map)
                // [T8/AC3 · D3] 吸附格心时拒绝叠放：若目标格被占用，改放到最近空格。
                const pos = shouldSnapTokenOnDrop(t, map)
                  ? resolveFreeDropCell(snapped.x, snapped.y, t.id, map)
                  : snapped
                updateToken(map.id, t.id, pos)
                setDragPreviewPositions((prev) => {
                  if (!prev[t.id]) return prev
                  const next = { ...prev }
                  delete next[t.id]
                  return next
                })
              }}
              onDragMove={(x, y) => {
                setDragPreviewPositions((prev) => ({
                  ...prev,
                  [t.id]: { x, y },
                }))
              }}
              onDragCancel={() => {
                // [T8/AC5 · D5] 子阈值拖拽：仅清理预览，不写入/广播。
                setDragPreviewPositions((prev) => {
                  if (!prev[t.id]) return prev
                  const next = { ...prev }
                  delete next[t.id]
                  return next
                })
              }}
            />
            )
          })}

          {projectiles.map((projectile) => (
            <ProjectileArrow key={projectile.id} projectile={projectile} />
          ))}

          {map.tokens.map((t) => {
            const hp = hpByToken?.[t.id]
            const defeated = hp != null ? hp.hp <= 0 : defeatedTokenIds.includes(t.id)
            return (
              <TokenNode
                key={`label-${t.id}`}
                renderMode="label"
                token={displayToken(t)}
                gridSize={map.gridSize}
                builtinGrid={builtinGrid}
                selected={t.id === selectedTokenId}
                defeated={defeated}
                draggable={false}
                hp={hpByToken?.[t.id]}
                showHpBar={
                  !!hpByToken?.[t.id] &&
                  (isDM || !!t.characterId || t.showHpOnToken !== false)
                }
                doubleArrowBadge={tokenBadges[t.id]?.doubleArrow}
                eagleEyeBadge={tokenBadges[t.id]?.eagleEye}
                silentDrawBadge={tokenBadges[t.id]?.silentDraw}
                preciseStrikeBadge={tokenBadges[t.id]?.preciseStrike}
                calmMindBadge={tokenBadges[t.id]?.calmMind}
                calmSpiritStacks={tokenBadges[t.id]?.calmSpiritStacks}
                outOfBreathBadge={tokenBadges[t.id]?.outOfBreath}
                huntingMarkStacks={tokenBadges[t.id]?.huntingMarkStacks}
                hoverLabel={hoveredTokenId === t.id ? tokenHoverLabels[t.id] : undefined}
                onHoverChange={() => undefined}
                onSelect={() => undefined}
                instantPosition={!!dragPreviewPositions[t.id]}
                onDragEnd={() => undefined}
              />
            )
          })}

          {map.tokens.map((t) => {
            const hp = hpByToken?.[t.id]
            const defeated = hp != null ? hp.hp <= 0 : defeatedTokenIds.includes(t.id)
            return (
              <TokenNode
                key={`vitals-${t.id}`}
                renderMode="vitals"
                token={displayToken(t)}
                gridSize={map.gridSize}
                builtinGrid={builtinGrid}
                selected={t.id === selectedTokenId}
                defeated={defeated}
                draggable={false}
                hp={hpByToken?.[t.id]}
                showHpBar={
                  !!hpByToken?.[t.id] &&
                  (isDM || !!t.characterId || t.showHpOnToken !== false)
                }
                doubleArrowBadge={tokenBadges[t.id]?.doubleArrow}
                eagleEyeBadge={tokenBadges[t.id]?.eagleEye}
                silentDrawBadge={tokenBadges[t.id]?.silentDraw}
                preciseStrikeBadge={tokenBadges[t.id]?.preciseStrike}
                calmMindBadge={tokenBadges[t.id]?.calmMind}
                calmSpiritStacks={tokenBadges[t.id]?.calmSpiritStacks}
                outOfBreathBadge={tokenBadges[t.id]?.outOfBreath}
                huntingMarkStacks={tokenBadges[t.id]?.huntingMarkStacks}
                hoverLabel={hoveredTokenId === t.id ? tokenHoverLabels[t.id] : undefined}
                onHoverChange={() => undefined}
                onSelect={() => undefined}
                instantPosition={!!dragPreviewPositions[t.id]}
                onDragEnd={() => undefined}
              />
            )
          })}

          {deleteDrag && (
            <Rect
              {...rectFromPoints(deleteDrag.start, deleteDrag.current)}
              fill="rgba(239,68,68,0.14)"
              stroke="rgba(248,113,113,0.95)"
              strokeWidth={2 * inv}
              dash={[10 * inv, 6 * inv]}
              listening={false}
            />
          )}

          {/* 已确定的测距线段（右键删除） */}
          {segments.map((seg, i) => (
            <MeasureLine
              key={i}
              a={seg.a}
              b={seg.b}
              cells={segmentCells(seg.a, seg.b)}
              snapMeasure={snapMeasure}
              inv={inv}
              onDelete={() => setSegments((segs) => segs.filter((_, idx) => idx !== i))}
            />
          ))}

          {/* 正在放置的预览线 */}
          {measureMode && pending && cursor && (
            <MeasureLine
              a={pending}
              b={cursor}
              cells={segmentCells(pending, cursor)}
              snapMeasure={snapMeasure}
              inv={inv}
              preview
            />
          )}
        </Layer>
      </Stage>
    </div>
  )
}

function MeasureLine({
  a,
  b,
  cells,
  snapMeasure,
  inv,
  preview = false,
  onDelete,
}: {
  a: Point
  b: Point
  cells: number
  snapMeasure: boolean
  inv: number
  preview?: boolean
  onDelete?: () => void
}) {
  const feet = cells * DND_FEET_PER_CELL
  const label = snapMeasure
    ? `${cells} 格 / ${feet} 尺`
    : `${cells.toFixed(1)} 格 / ${feet.toFixed(1)} 尺`
  const degenerate = measurePointsEqual(a, b)
  const handleDelete = onDelete
    ? (e: Konva.KonvaEventObject<PointerEvent>) => {
        e.evt.preventDefault()
        e.cancelBubble = true
        onDelete()
      }
    : undefined

  return (
    <Group>
      {!degenerate && (
        <Line
          points={[a.x, a.y, b.x, b.y]}
          stroke="#fbbf24"
          strokeWidth={3.5 * inv}
          dash={[10 * inv, 7 * inv]}
          hitStrokeWidth={22 * inv}
          opacity={preview ? 0.7 : 1}
          onContextMenu={handleDelete}
        />
      )}
      <Circle
        x={a.x}
        y={a.y}
        radius={6 * inv}
        fill="#fbbf24"
        hitStrokeWidth={18 * inv}
        onContextMenu={handleDelete}
      />
      {!degenerate && (
        <Circle
          x={b.x}
          y={b.y}
          radius={6 * inv}
          fill="#fbbf24"
          hitStrokeWidth={18 * inv}
          onContextMenu={handleDelete}
        />
      )}
      <Group x={b.x} y={b.y}>
        <Rect
          x={12 * inv}
          y={-15 * inv}
          width={150 * inv}
          height={30 * inv}
          fill="rgba(10,11,22,0.9)"
          stroke="#fbbf24"
          strokeWidth={inv}
          cornerRadius={6 * inv}
          onContextMenu={handleDelete}
        />
        <Text
          x={12 * inv}
          y={-15 * inv}
          width={150 * inv}
          height={30 * inv}
          text={label}
          fontSize={14 * inv}
          fontStyle="bold"
          fill="#fde68a"
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      </Group>
    </Group>
  )
}

function ProjectileArrow({ projectile }: { projectile: MapProjectile }) {
  const groupRef = useRef<Konva.Group>(null)
  const arrowRef = useRef<Konva.Arrow>(null)
  const glowRef = useRef<Konva.Arrow>(null)
  const pathRef = useRef<Konva.Line>(null)
  const chargeRef = useRef<Konva.Circle>(null)

  useEffect(() => {
    const group = groupRef.current
    const arrow = arrowRef.current
    const glow = glowRef.current
    const path = pathRef.current
    const charge = chargeRef.current
    const layer = group?.getLayer()
    if (!group || !arrow || !layer) return
    const dx = projectile.to.x - projectile.from.x
    const dy = projectile.to.y - projectile.from.y
    const dist = Math.max(1, Math.hypot(dx, dy))
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI
    const focus = projectile.kind === 'focus'
    const trail = focus ? Math.min(68, Math.max(28, dist * 0.22)) : Math.min(42, Math.max(18, dist * 0.16))
    group.position(projectile.from)
    group.rotation(angle)
    arrow.points([-trail, 0, 0, 0])
    glow?.points([-trail * 1.05, 0, 0, 0])
    path?.points([0, 0, dist, 0])
    const duration = focus ? 780 : 460
    const anim = new Konva.Animation((frame) => {
      const elapsed = frame?.time ?? 0
      const raw = Math.min(1, elapsed / duration)
      const chargePhase = focus ? 0.28 : 0
      const travelRaw = chargePhase > 0 ? Math.max(0, (raw - chargePhase) / (1 - chargePhase)) : raw
      const p = 1 - Math.pow(1 - travelRaw, 2.4)
      const fade = raw < 0.78 ? 1 : Math.max(0, (1 - raw) / 0.22)
      if (focus && charge) {
        const pulse = raw < chargePhase ? 0.65 + Math.sin(raw * 44) * 0.2 : Math.max(0, 1 - travelRaw)
        charge.radius(10 + pulse * 12)
        charge.opacity(Math.max(0, pulse))
      }
      if (focus && path) {
        const pulse = raw < chargePhase ? 0.72 + Math.sin(raw * 38) * 0.18 : Math.max(0.18, 1 - travelRaw * 0.7)
        path.opacity(pulse)
      }
      group.x(projectile.from.x + dx * p)
      group.y(projectile.from.y + dy * p)
      group.opacity(fade)
    }, layer)
    anim.start()
    return () => {
      anim.stop()
    }
  }, [projectile])

  return (
    <>
      {projectile.kind === 'focus' && (
        <Group
          x={projectile.from.x}
          y={projectile.from.y}
          rotation={(Math.atan2(projectile.to.y - projectile.from.y, projectile.to.x - projectile.from.x) * 180) / Math.PI}
          listening={false}
        >
          <Circle
            ref={chargeRef}
            radius={12}
            fill="rgba(168,85,247,0.22)"
            stroke="rgba(216,180,254,0.95)"
            strokeWidth={2}
            shadowBlur={18}
            shadowColor="#a855f7"
          />
          <Line
            ref={pathRef}
            points={[0, 0, 60, 0]}
            stroke="rgba(167,139,250,0.95)"
            strokeWidth={18}
            lineCap="round"
            shadowBlur={28}
            shadowColor="#a855f7"
          />
          <Line
            points={[0, 0, Math.hypot(projectile.to.x - projectile.from.x, projectile.to.y - projectile.from.y), 0]}
            stroke="rgba(56,189,248,0.62)"
            strokeWidth={8}
            lineCap="round"
            shadowBlur={18}
            shadowColor="#38bdf8"
          />
        </Group>
      )}
    <Group ref={groupRef} listening={false}>
      <Arrow
        ref={glowRef}
        points={[-24, 0, 0, 0]}
        stroke={projectile.kind === 'focus' ? 'rgba(168,85,247,0.55)' : 'rgba(250, 204, 21, 0.36)'}
        strokeWidth={projectile.kind === 'focus' ? 10 : 7}
        pointerLength={projectile.kind === 'focus' ? 14 : 10}
        pointerWidth={projectile.kind === 'focus' ? 14 : 10}
        lineCap="round"
        lineJoin="round"
        shadowBlur={10}
        shadowColor={projectile.kind === 'focus' ? '#a855f7' : '#facc15'}
      />
      <Arrow
        ref={arrowRef}
        points={[-24, 0, 0, 0]}
        stroke={projectile.kind === 'focus' ? '#ddd6fe' : '#f8fafc'}
        fill={projectile.kind === 'focus' ? '#c084fc' : '#f8fafc'}
        strokeWidth={projectile.kind === 'focus' ? 3.4 : 2.2}
        pointerLength={projectile.kind === 'focus' ? 13 : 9}
        pointerWidth={projectile.kind === 'focus' ? 12 : 8}
        lineCap="round"
        lineJoin="round"
        shadowBlur={4}
        shadowColor={projectile.kind === 'focus' ? '#7c3aed' : 'rgba(15,23,42,0.65)'}
      />
    </Group>
    </>
  )
}

function TokenNode({
  renderMode = 'full',
  token,
  gridSize,
  builtinGrid = false,
  selected,
  defeated = false,
  draggable = true,
  hp,
  showHpBar = true,
  doubleArrowBadge = false,
  eagleEyeBadge = false,
  silentDrawBadge = false,
  preciseStrikeBadge = false,
  calmMindBadge = false,
  calmSpiritStacks = 0,
  outOfBreathBadge = false,
  huntingMarkStacks = 0,
  hoverLabel,
  onHoverChange,
  onSelect,
  onDragMove,
  onDragEnd,
  onDragCancel,
  instantPosition = false,
}: {
  renderMode?: 'full' | 'body' | 'overlay' | 'label' | 'vitals'
  token: Token
  gridSize: number
  builtinGrid?: boolean
  selected: boolean
  defeated?: boolean
  draggable?: boolean
  hp?: { hp: number; max: number; temp?: number }
  showHpBar?: boolean
  doubleArrowBadge?: boolean
  eagleEyeBadge?: boolean
  silentDrawBadge?: boolean
  preciseStrikeBadge?: boolean
  calmMindBadge?: boolean
  calmSpiritStacks?: number
  outOfBreathBadge?: boolean
  huntingMarkStacks?: number
  hoverLabel?: string
  onHoverChange?: (hovered: boolean) => void
  onSelect: () => void
  onDragMove?: (x: number, y: number) => void
  onDragEnd: (x: number, y: number) => void
  /** [T8/AC5] 低于阈值的拖拽（点击/抖动）取消：清理拖拽预览且不提交移动/广播 */
  onDragCancel?: () => void
  instantPosition?: boolean
}) {
  const groupRef = useRef<Konva.Group>(null)
  const draggingRef = useRef(false)
  const suppressClickUntilRef = useRef(0)
  const prevGridSizeRef = useRef(gridSize)
  // [T8/AC5 · D5] 拖拽起点（用于判断是否超过移动阈值）
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  // [T8/AC8 · D10] 当前在途的位置补间，启动新补间前先销毁它
  const reconcileTweenRef = useRef<Konva.Tween | null>(null)
  const radius = tokenDisplayRadius(gridSize, token.size, builtinGrid)
  const labelSize = Math.max(9, radius * 0.42)
  const labelBarH = Math.max(14, radius * 0.55)
  const scale = tokenScale(radius)
  const selectedStrokeW = tokenLineWidth(radius, 3)
  const selectedGap = 5 * scale
  const statusStrokeW = tokenLineWidth(radius, 4)
  const baseStrokeW = tokenLineWidth(radius, 3)
  const secondaryStrokeW = tokenLineWidth(radius, 2.5)
  const tempHp = Math.max(0, hp?.temp ?? 0)
  const hpDenominator = hp ? Math.max(1, hp.max + tempHp) : 1
  const hpPct = hp ? Math.max(0, Math.min(1, hp.hp / hpDenominator)) : null
  const tempHpPct = hp ? Math.max(0, Math.min(1 - (hpPct ?? 0), tempHp / hpDenominator)) : 0
  const realHpPct = hp && hp.max > 0 ? Math.max(0, Math.min(1, hp.hp / hp.max)) : null
  const hpColor = defeated
    ? '#64748b'
    : realHpPct === null
      ? '#888'
      : realHpPct > 0.5
        ? '#34d399'
        : realHpPct > 0.25
          ? '#fbbf24'
          : '#f87171'
  const strokeColor = defeated
    ? '#94a3b8'
    : (token.stunTurns ?? 0) > 0
      ? '#facc15'
      : (token.knockbackTurns ?? 0) > 0
        ? '#38bdf8'
        : (token.burningTurns ?? 0) > 0
          ? '#fb923c'
          : (token.igniteTurns ?? 0) > 0
            ? '#ef4444'
            : (token.poisonTurns ?? 0) > 0
              ? '#4ade80'
              : outOfBreathBadge
                ? OUT_OF_BREATH_RING_COLOR
                : calmMindBadge
                  ? CALM_MIND_RING_COLOR
                  : token.color
  const barW = radius * 2

  useLayoutEffect(() => {
    const node = groupRef.current
    if (!node) return
    node.position({ x: token.x, y: token.y })
  }, [token.id])

  useEffect(() => {
    const node = groupRef.current
    if (!node) return

    if (prevGridSizeRef.current !== gridSize) {
      prevGridSizeRef.current = gridSize
      node.position({ x: token.x, y: token.y })
      return
    }

    if (draggingRef.current || instantPosition) {
      node.position({ x: token.x, y: token.y })
      return
    }

    const dist = Math.hypot(node.x() - token.x, node.y() - token.y)
    if (dist < 1) {
      // [T8/AC8 · D10] 已到位前也先停掉任何在途补间，避免残留动画把节点拉走。
      reconcileTweenRef.current?.destroy()
      reconcileTweenRef.current = null
      node.position({ x: token.x, y: token.y })
      return
    }

    // [T8/AC8 · D10] 启动新补间前，取消/销毁上一个在途补间，杜绝叠加动画。
    reconcileTweenRef.current?.destroy()
    const tween = new Konva.Tween({
      node,
      x: token.x,
      y: token.y,
      duration: TOKEN_MOVE_DURATION,
      easing: Konva.Easings.EaseInOut,
      onFinish: () => {
        if (reconcileTweenRef.current === tween) reconcileTweenRef.current = null
      },
    })
    reconcileTweenRef.current = tween
    tween.play()
  }, [token.x, token.y, gridSize, instantPosition])

  const nameLayer = (
    <Group y={radius + 4}>
      <Rect
        x={-radius - 6}
        width={(radius + 6) * 2}
        height={labelBarH}
        fill="rgba(10,11,22,0.8)"
        cornerRadius={Math.max(4, radius * 0.12)}
      />
      <Text
        text={token.label}
        fontSize={labelSize}
        fill={defeated ? '#94a3b8' : '#e2e8f0'}
        width={(radius + 6) * 2}
        offsetX={radius + 6}
        height={labelBarH}
        align="center"
        verticalAlign="middle"
      />
    </Group>
  )

  const vitalsLayer = (
    <>
      {showHpBar && hpPct !== null && (
        <Group y={-radius - 12}>
          <Rect x={-barW / 2} width={barW} height={6} cornerRadius={3} fill="rgba(10,11,22,0.85)" />
          {tempHp > 0 ? (
            <>
              <Rect
                x={-barW / 2}
                width={barW * (hpPct + tempHpPct)}
                height={6}
                cornerRadius={3}
                fill="#facc15"
                opacity={0.95}
              />
              <Rect x={-barW / 2} width={barW * hpPct} height={6} cornerRadius={3} fill={hpColor} />
              {hpPct > 0 && tempHpPct > 0 && (
                <>
                  <Rect
                    x={-barW / 2 + Math.max(0, barW * hpPct - 3)}
                    width={3}
                    height={6}
                    fill={hpColor}
                  />
                  <Rect
                    x={-barW / 2 + Math.max(0, barW * hpPct - 0.5)}
                    width={1}
                    height={6}
                    fill="rgba(15,23,42,0.75)"
                  />
                </>
              )}
            </>
          ) : (
            <Rect x={-barW / 2} width={barW * hpPct} height={6} cornerRadius={3} fill={hpColor} />
          )}
          <Text
            text={tempHp > 0 ? `${hp!.hp}/${hp!.max} (+${tempHp})` : `${hp!.hp}/${hp!.max}`}
            y={-labelSize - 2}
            width={barW * 1.8}
            x={-barW * 0.9}
            fontSize={labelSize}
            fill="#e2e8f0"
            align="center"
          />
        </Group>
      )}

      {(() => {
        let grid = 0
        return (
          <>
            {doubleArrowBadge && (
              <DoubleArrowBadge radius={radius} gridIndex={grid++} />
            )}
            {eagleEyeBadge && (
              <EagleEyeBadge radius={radius} gridIndex={grid++} />
            )}
            {silentDrawBadge && (
              <SilentDrawBadge radius={radius} gridIndex={grid++} />
            )}
            {preciseStrikeBadge && (
              <PreciseStrikeBadge radius={radius} gridIndex={grid++} />
            )}
            {((token.burningTurns ?? 0) > 0 || (token.igniteTurns ?? 0) > 0) && (
              <IgniteBadge radius={radius} gridIndex={grid++} />
            )}
            {(token.knockbackTurns ?? 0) > 0 && (
              <KnockbackBadge radius={radius} gridIndex={grid++} />
            )}
            {(token.stunTurns ?? 0) > 0 && (
              <StatusTurnBadge
                radius={radius}
                gridIndex={grid++}
                emoji="★"
                turns={token.stunTurns!}
                stroke="#facc15"
                fill="#fef9c3"
              />
            )}
            {(token.poisonTurns ?? 0) > 0 && (
              <PoisonBadge radius={radius} gridIndex={grid++} />
            )}
            {calmMindBadge &&
              (() => {
                const calmGrid = grid++
                return (
                  <>
                    <CalmMindBadge radius={radius} gridIndex={calmGrid} />
                    {calmSpiritStacks > 0 && (
                      <BadgeCornerNumber
                        radius={radius}
                        gridIndex={calmGrid}
                        text={String(calmSpiritStacks)}
                        stroke="#ffffff"
                      />
                    )}
                  </>
                )
              })()}
            {outOfBreathBadge && (
              <OutOfBreathBadge radius={radius} gridIndex={grid++} />
            )}
            {huntingMarkStacks > 0 &&
              (() => {
                const markGrid = grid++
                return (
                  <>
                    <HuntingMarkBadge radius={radius} gridIndex={markGrid} />
                    <BadgeCornerNumber
                      radius={radius}
                      gridIndex={markGrid}
                      text={String(huntingMarkStacks)}
                      stroke="#ffffff"
                    />
                  </>
                )
              })()}
          </>
        )
      })()}

      {renderMode !== 'body' && hoverLabel && (
        <Group y={-radius - 34 * scale} listening={false}>
          <Rect
            x={-radius * 1.2}
            y={-10 * scale}
            width={radius * 2.4}
            height={20 * scale}
            cornerRadius={5 * scale}
            fill="rgba(10,11,22,0.92)"
            stroke="rgba(125,211,252,0.65)"
            strokeWidth={tokenLineWidth(radius, 1)}
            shadowBlur={6 * scale}
            shadowColor="rgba(0,0,0,0.55)"
          />
          <Text
            text={hoverLabel}
            x={-radius * 1.2}
            y={-8 * scale}
            width={radius * 2.4}
            height={16 * scale}
            fontSize={Math.max(8, radius * 0.32)}
            fontStyle="bold"
            fill="#bae6fd"
            align="center"
            verticalAlign="middle"
            listening={false}
          />
        </Group>
      )}
    </>
  )

  const infoLayer = (
    <>
      {nameLayer}
      {vitalsLayer}
    </>
  )

  if (renderMode === 'overlay' || renderMode === 'label' || renderMode === 'vitals') {
    return (
      <Group
        ref={groupRef}
        listening={false}
        opacity={defeated ? 0.75 : 1}
      >
        {renderMode === 'label' ? nameLayer : renderMode === 'vitals' ? vitalsLayer : infoLayer}
      </Group>
    )
  }

  const handleTokenSelect = () => {
    if (draggingRef.current || Date.now() < suppressClickUntilRef.current) return
    onSelect()
  }

  return (
    <Group
      ref={groupRef}
      name="map-token"
      draggable={draggable}
      opacity={defeated ? 0.55 : 1}
      onClick={handleTokenSelect}
      onTap={handleTokenSelect}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      onDragStart={(e) => {
        draggingRef.current = true
        dragStartRef.current = { x: e.target.x(), y: e.target.y() }
      }}
      onDragMove={(e) => {
        onDragMove?.(e.target.x(), e.target.y())
      }}
      onDragEnd={(e) => {
        suppressClickUntilRef.current = Date.now() + 250
        draggingRef.current = false
        const x = e.target.x()
        const y = e.target.y()
        const start = dragStartRef.current
        dragStartRef.current = null
        // [T8/AC5 · D5] 位移小于阈值（点击/抖动）：不提交移动/广播，回弹到原位并清理预览。
        if (start && Math.hypot(x - start.x, y - start.y) < TOKEN_DRAG_THRESHOLD_PX) {
          e.target.position({ x: token.x, y: token.y })
          onDragCancel?.()
          return
        }
        onDragEnd(x, y)
      }}
    >
      {selected && (
        <Circle
          radius={radius + selectedGap}
          stroke="#a78bfa"
          strokeWidth={selectedStrokeW}
          dash={tokenDash(radius, [8, 6])}
          listening={false}
        />
      )}
      {(token.stunTurns ?? 0) > 0 && <StunGlow radius={radius} />}
      {(token.knockbackTurns ?? 0) > 0 && <KnockbackLiftGlow radius={radius} />}
      {calmMindBadge && <CalmMindAura radius={radius} />}
      {outOfBreathBadge && <OutOfBreathHeat radius={radius} />}
      {((token.burningTurns ?? 0) > 0 || (token.igniteTurns ?? 0) > 0) && (
        <BurningGlow radius={radius} />
      )}
      {(token.poisonTurns ?? 0) > 0 && <PoisonCloudGlow radius={radius} />}
      <Circle
        radius={radius}
        fill={defeated ? 'rgba(30,32,45,0.92)' : 'rgba(10,11,22,0.85)'}
        stroke={strokeColor}
        strokeWidth={
          (token.stunTurns ?? 0) > 0 ||
          (token.knockbackTurns ?? 0) > 0 ||
          (token.burningTurns ?? 0) > 0 ||
          (token.igniteTurns ?? 0) > 0 ||
          (token.poisonTurns ?? 0) > 0 ||
          calmMindBadge ||
          outOfBreathBadge
            ? statusStrokeW
            : baseStrokeW
        }
      />
      {defeated && (
        <Circle
          radius={radius}
          fill="rgba(148,163,184,0.35)"
          listening={false}
        />
      )}
      {(token.poisonTurns ?? 0) > 0 && (token.burningTurns ?? 0) > 0 && (
        <Circle
          radius={radius + 3 * scale}
          stroke="#86efac"
          strokeWidth={secondaryStrokeW}
          opacity={0.7}
          dash={tokenDash(radius, [4, 6])}
          listening={false}
        />
      )}

      {renderMode !== 'body' && hoverLabel && (
        <Group y={-radius - 34 * scale} listening={false}>
          <Rect
            x={-radius * 1.2}
            y={-10 * scale}
            width={radius * 2.4}
            height={20 * scale}
            cornerRadius={5 * scale}
            fill="rgba(10,11,22,0.92)"
            stroke="rgba(125,211,252,0.65)"
            strokeWidth={tokenLineWidth(radius, 1)}
            shadowBlur={6 * scale}
            shadowColor="rgba(0,0,0,0.55)"
          />
          <Text
            text={hoverLabel}
            x={-radius * 1.2}
            y={-8 * scale}
            width={radius * 2.4}
            height={16 * scale}
            fontSize={Math.max(8, radius * 0.32)}
            fontStyle="bold"
            fill="#bae6fd"
            align="center"
            verticalAlign="middle"
            listening={false}
          />
        </Group>
      )}

      {/* 生命条（Token 上方） */}
      {renderMode !== 'body' && showHpBar && hpPct !== null && (
        <Group y={-radius - 12}>
          <Rect x={-barW / 2} width={barW} height={6} cornerRadius={3} fill="rgba(10,11,22,0.85)" />
          {tempHp > 0 ? (
            <>
              <Rect
                x={-barW / 2}
                width={barW * (hpPct + tempHpPct)}
                height={6}
                cornerRadius={3}
                fill="#facc15"
                opacity={0.95}
              />
              <Rect x={-barW / 2} width={barW * hpPct} height={6} cornerRadius={3} fill={hpColor} />
              {hpPct > 0 && tempHpPct > 0 && (
                <>
                  <Rect
                    x={-barW / 2 + Math.max(0, barW * hpPct - 3)}
                    width={3}
                    height={6}
                    fill={hpColor}
                  />
                  <Rect
                    x={-barW / 2 + Math.max(0, barW * hpPct - 0.5)}
                    width={1}
                    height={6}
                    fill="rgba(15,23,42,0.75)"
                  />
                </>
              )}
            </>
          ) : (
            <Rect x={-barW / 2} width={barW * hpPct} height={6} cornerRadius={3} fill={hpColor} />
          )}
          <Text
            text={tempHp > 0 ? `${hp!.hp}/${hp!.max} (+${tempHp})` : `${hp!.hp}/${hp!.max}`}
            y={-labelSize - 2}
            width={barW * 1.8}
            x={-barW * 0.9}
            fontSize={labelSize}
            fill="#e2e8f0"
            align="center"
          />
        </Group>
      )}
      <Text
        text={token.emoji}
        fontSize={radius}
        width={radius * 2}
        height={radius * 2}
        offsetX={radius}
        offsetY={radius}
        align="center"
        verticalAlign="middle"
        opacity={defeated ? 0.65 : 1}
      />
      {((token.burningTurns ?? 0) > 0 || (token.igniteTurns ?? 0) > 0) && (
        <BurningFlames radius={radius} />
      )}
      {(token.poisonTurns ?? 0) > 0 && <PoisonCloud radius={radius} />}
      {(token.stunTurns ?? 0) > 0 && <StunOrbitStars radius={radius} />}
      {renderMode !== 'body' && (() => {
        let grid = 0
        return (
          <>
            {doubleArrowBadge && (
              <DoubleArrowBadge radius={radius} gridIndex={grid++} />
            )}
            {eagleEyeBadge && (
              <EagleEyeBadge radius={radius} gridIndex={grid++} />
            )}
            {silentDrawBadge && (
              <SilentDrawBadge radius={radius} gridIndex={grid++} />
            )}
            {preciseStrikeBadge && (
              <PreciseStrikeBadge radius={radius} gridIndex={grid++} />
            )}
            {((token.burningTurns ?? 0) > 0 || (token.igniteTurns ?? 0) > 0) && (
              <IgniteBadge radius={radius} gridIndex={grid++} />
            )}
            {(token.knockbackTurns ?? 0) > 0 && (
              <KnockbackBadge radius={radius} gridIndex={grid++} />
            )}
            {(token.stunTurns ?? 0) > 0 && (
              <StatusTurnBadge
                radius={radius}
                gridIndex={grid++}
                emoji="★"
                turns={token.stunTurns!}
                stroke="#facc15"
                fill="#fef9c3"
              />
            )}
            {(token.poisonTurns ?? 0) > 0 && (
              <PoisonBadge radius={radius} gridIndex={grid++} />
            )}
            {calmMindBadge &&
              (() => {
                const calmGrid = grid++
                return (
                  <>
                    <CalmMindBadge radius={radius} gridIndex={calmGrid} />
                    {calmSpiritStacks > 0 && (
                      <BadgeCornerNumber
                        radius={radius}
                        gridIndex={calmGrid}
                        text={String(calmSpiritStacks)}
                        stroke="#ffffff"
                      />
                    )}
                  </>
                )
              })()}
            {outOfBreathBadge && (
              <OutOfBreathBadge radius={radius} gridIndex={grid++} />
            )}
            {huntingMarkStacks > 0 &&
              (() => {
                const markGrid = grid++
                return (
                  <>
                    <HuntingMarkBadge radius={radius} gridIndex={markGrid} />
                    <BadgeCornerNumber
                      radius={radius}
                      gridIndex={markGrid}
                      text={String(huntingMarkStacks)}
                      stroke="#ffffff"
                    />
                  </>
                )
              })()}
          </>
        )
      })()}
      {/* 名称标签 */}
      {renderMode !== 'body' && (
        <Group y={radius + 4}>
          <Rect
            x={-radius - 6}
            width={(radius + 6) * 2}
            height={labelBarH}
            fill="rgba(10,11,22,0.8)"
            cornerRadius={Math.max(4, radius * 0.12)}
          />
          <Text
            text={token.label}
            fontSize={labelSize}
            fill={defeated ? '#94a3b8' : '#e2e8f0'}
            width={(radius + 6) * 2}
            offsetX={radius + 6}
            height={labelBarH}
            align="center"
            verticalAlign="middle"
          />
        </Group>
      )}
    </Group>
  )
}

const FLAME_PARTICLE_COUNT = 20
const FLAME_COLORS = ['#ef4444', '#dc2626', '#f97316', '#ea580c', '#fb923c', '#c2410c']

/** 燃烧光晕（在 token 底层，向外扩散） */
function BurningGlow({ radius }: { radius: number }) {
  const glowRef = useRef<Konva.Circle>(null)
  const ringRef = useRef<Konva.Circle>(null)

  useStatusAnimation(
    () => glowRef.current?.getLayer() ?? null,
    (frame) => {
      const t = (frame?.time ?? 0) / 1000
      if (glowRef.current) {
        glowRef.current.radius(radius * (1.12 + Math.sin(t * 5.5) * 0.1))
        glowRef.current.opacity(0.22 + Math.sin(t * 7) * 0.1)
      }
      if (ringRef.current) {
        ringRef.current.radius(radius * (1.08 + Math.sin(t * 4) * 0.06))
        ringRef.current.opacity(0.5 + Math.sin(t * 8) * 0.2)
      }
    },
    [radius],
  )

  return (
    <Group listening={false}>
      <Circle ref={glowRef} radius={radius * 1.15} fill="#f97316" opacity={0.28} listening={false} />
      <Circle
        ref={ringRef}
        radius={radius * 1.08}
        stroke="#fb923c"
        strokeWidth={tokenLineWidth(radius, 2)}
        opacity={0.55}
        dash={tokenDash(radius, [5, 7])}
        listening={false}
      />
    </Group>
  )
}

/** 燃烧火焰粒子（在 emoji 上层，环绕飘动） */
function BurningFlames({ radius }: { radius: number }) {
  const groupRef = useRef<Konva.Group>(null)
  const particleRefs = useRef<(Konva.Circle | null)[]>([])

  useStatusAnimation(
    () => groupRef.current?.getLayer() ?? null,
    (frame) => {
      const t = (frame?.time ?? 0) / 1000
      particleRefs.current.forEach((p, i) => {
        if (!p) return
        const angle = t * 3 + i * ((Math.PI * 2) / FLAME_PARTICLE_COUNT)
        const rise = Math.abs(Math.sin(t * 4 + i * 0.9))
        const orbit = 0.48 + (i % 4) * 0.06
        p.x(Math.cos(angle) * radius * orbit)
        p.y(-radius * 0.3 - rise * radius * 0.58)
        p.opacity(0.5 + Math.sin(t * 9 + i * 2) * 0.4)
        p.radius(radius * (0.07 + (i % 3) * 0.012 + Math.sin(t * 6 + i) * 0.022))
      })
    },
    [radius],
  )

  return (
    <Group ref={groupRef} listening={false}>
      {Array.from({ length: FLAME_PARTICLE_COUNT }, (_, i) => (
        <Circle
          key={i}
          ref={(el) => {
            particleRefs.current[i] = el
          }}
          radius={radius * 0.1}
          fill={FLAME_COLORS[i % FLAME_COLORS.length]}
          shadowBlur={8}
          shadowColor="#ea580c"
          listening={false}
        />
      ))}
    </Group>
  )
}

const STUN_STAR_COUNT = 4

/** 眩晕：头顶星星绕圈旋转 */
function StunOrbitStars({ radius }: { radius: number }) {
  const groupRef = useRef<Konva.Group>(null)
  const starRefs = useRef<(Konva.Text | null)[]>([])

  const orbitR = radius * 0.62
  const centerY = -radius * 1.22
  useStatusAnimation(
    () => groupRef.current?.getLayer() ?? null,
    (frame) => {
      const t = (frame?.time ?? 0) / 1000
      starRefs.current.forEach((star, i) => {
        if (!star) return
        const baseAngle = (i * 2 * Math.PI) / STUN_STAR_COUNT
        const angle = t * 3.2 + baseAngle
        star.x(Math.cos(angle) * orbitR)
        star.y(centerY + Math.sin(angle) * orbitR * 0.45)
        star.rotation((t * 220 + i * 90) % 360)
        star.opacity(0.75 + Math.sin(t * 6 + i) * 0.25)
      })
    },
    [radius],
  )

  const starSize = Math.max(10, radius * 0.34)
  return (
    <Group ref={groupRef} listening={false}>
      {Array.from({ length: STUN_STAR_COUNT }, (_, i) => (
        <Text
          key={i}
          ref={(el) => {
            starRefs.current[i] = el
          }}
          text="★"
          fontSize={starSize}
          fill="#fde047"
          stroke="#ca8a04"
          strokeWidth={tokenLineWidth(radius, 0.5)}
          offsetX={starSize / 2}
          offsetY={starSize / 2}
          shadowBlur={6 * tokenScale(radius)}
          shadowColor="#eab308"
          listening={false}
        />
      ))}
    </Group>
  )
}

function StunGlow({ radius }: { radius: number }) {
  const ringRef = useRef<Konva.Circle>(null)

  useStatusAnimation(
    () => ringRef.current?.getLayer() ?? null,
    (frame) => {
      const ring = ringRef.current
      if (!ring || !frame) return
      const t = frame.time / 600
      ring.opacity(0.2 + Math.sin(t) * 0.15)
      ring.radius(radius + 3 + Math.sin(t * 1.2) * 2)
    },
    [radius],
  )

  return (
    <Circle
      ref={ringRef}
      radius={radius + 3 * tokenScale(radius)}
      stroke="#facc15"
      strokeWidth={tokenLineWidth(radius, 2)}
      dash={tokenDash(radius, [4, 4])}
      opacity={0.25}
      listening={false}
    />
  )
}

function KnockbackLiftGlow({ radius }: { radius: number }) {
  const ringRef = useRef<Konva.Circle>(null)

  useStatusAnimation(
    () => ringRef.current?.getLayer() ?? null,
    (frame) => {
      const ring = ringRef.current
      if (!ring || !frame) return
      const t = frame.time / 700
      ring.opacity(0.22 + Math.sin(t) * 0.12)
      ring.radius(radius + 4 + Math.sin(t * 1.4) * 2)
    },
    [radius],
  )

  return (
    <Circle
      ref={ringRef}
      radius={radius + 4 * tokenScale(radius)}
      stroke="#38bdf8"
      strokeWidth={tokenLineWidth(radius, 2)}
      dash={tokenDash(radius, [6, 5])}
      opacity={0.28}
      listening={false}
    />
  )
}

function CalmMindAura({ radius }: { radius: number }) {
  const ringRef = useRef<Konva.Circle>(null)
  const glowRef = useRef<Konva.Circle>(null)

  useStatusAnimation(
    () => ringRef.current?.getLayer() ?? glowRef.current?.getLayer() ?? null,
    (frame) => {
      const ring = ringRef.current
      const glow = glowRef.current
      if (!ring || !glow) return
      const t = (frame?.time ?? 0) / 1000
      const pulse = 0.5 + Math.sin(t * 1.7) * 0.5
      ring.radius(radius + 4 + pulse * 3)
      ring.opacity(0.28 + pulse * 0.18)
      ring.rotation((t * 28) % 360)
      glow.radius(radius * (1.12 + pulse * 0.08))
      glow.opacity(0.14 + pulse * 0.1)
    },
    [radius],
  )

  return (
    <Group listening={false}>
      <Circle
        ref={glowRef}
        radius={radius * 1.16}
        fillRadialGradientStartPoint={{ x: 0, y: 0 }}
        fillRadialGradientStartRadius={radius * 0.18}
        fillRadialGradientEndPoint={{ x: 0, y: 0 }}
        fillRadialGradientEndRadius={radius * 1.2}
        fillRadialGradientColorStops={[
          0,
          'rgba(45,212,191,0.28)',
          0.62,
          'rgba(20,184,166,0.16)',
          1,
          'rgba(20,184,166,0)',
        ]}
        opacity={0.18}
        listening={false}
      />
      <Circle
        ref={ringRef}
        radius={radius + 5 * tokenScale(radius)}
        stroke={CALM_MIND_RING_COLOR}
        strokeWidth={tokenLineWidth(radius, 2)}
        dash={tokenDash(radius, [3, 8])}
        opacity={0.34}
        listening={false}
      />
    </Group>
  )
}

const BREATH_PARTICLE_COUNT = 7

function OutOfBreathHeat({ radius }: { radius: number }) {
  const ringRef = useRef<Konva.Circle>(null)
  const particleRefs = useRef<(Konva.Circle | null)[]>([])

  useStatusAnimation(
    () => ringRef.current?.getLayer() ?? null,
    (frame) => {
      const ring = ringRef.current
      if (!ring) return
      const t = (frame?.time ?? 0) / 1000
      const pulse = 0.5 + Math.sin(t * 3.1) * 0.5
      ring.radius(radius + 3 + pulse * 4)
      ring.opacity(0.24 + pulse * 0.16)
      ring.rotation((t * -46) % 360)
      particleRefs.current.forEach((p, i) => {
        if (!p) return
        const phase = i * 0.78
        const rise = ((t * 0.75 + i * 0.13) % 1)
        const side = i % 2 === 0 ? -1 : 1
        p.x(side * radius * (0.22 + (i % 3) * 0.08) + Math.sin(t * 2.1 + phase) * radius * 0.08)
        p.y(radius * 0.45 - rise * radius * 1.45)
        p.radius(radius * (0.045 + (i % 3) * 0.01))
        p.opacity((1 - rise) * (0.28 + pulse * 0.18))
      })
    },
    [radius],
  )

  return (
    <Group listening={false}>
      <Circle
        ref={ringRef}
        radius={radius + 4 * tokenScale(radius)}
        stroke={OUT_OF_BREATH_RING_COLOR}
        strokeWidth={tokenLineWidth(radius, 2)}
        dash={tokenDash(radius, [8, 5])}
        opacity={0.28}
        listening={false}
      />
      {Array.from({ length: BREATH_PARTICLE_COUNT }, (_, i) => (
        <Circle
          key={i}
          ref={(el) => {
            particleRefs.current[i] = el
          }}
          radius={radius * 0.05}
          fill={i % 2 === 0 ? '#fed7aa' : '#fdba74'}
          shadowBlur={5}
          shadowColor="#fb923c"
          opacity={0.18}
          listening={false}
        />
      ))}
    </Group>
  )
}

/** 回合数角标（眩晕/中毒等），纳入右侧网格 */
function StatusTurnBadge({
  radius,
  gridIndex,
  emoji,
  turns,
  stroke,
  fill,
}: {
  radius: number
  gridIndex: number
  emoji: string
  turns: number
  stroke: string
  fill: string
}) {
  const size = rightBadgeSize(radius)
  const { x, y } = rightBadgeGridPos(radius, size, gridIndex)
  const badgeFont = Math.max(8, size * 0.36)

  return (
    <Group x={x} y={y} listening={false}>
      <Circle
        radius={size / 2}
        fill="#ffffff"
        stroke={stroke}
        strokeWidth={tokenLineWidth(radius, 1.5)}
        listening={false}
      />
      <Text
        text={`${emoji}${turns}`}
        width={size}
        height={size}
        offsetX={size / 2}
        offsetY={size / 2}
        fontSize={badgeFont}
        fill={fill}
        align="center"
        verticalAlign="middle"
        listening={false}
      />
    </Group>
  )
}

interface FogLayerSlot {
  ox: number
  oy: number
  scale: number
  phase: number
  baseOpacity: number
  rot: number
}

const POISON_MIST_GRADIENT: (number | string)[] = [
  0,
  'rgba(130,255,70,0.52)',
  0.35,
  'rgba(80,200,40,0.30)',
  0.7,
  'rgba(30,120,30,0.14)',
  1,
  'rgba(30,120,30,0)',
]

/** 程序化生成重叠雾团（各自慢速漂移，非同向风） */
function buildPoisonFogLayer(
  count: number,
  veilCount: number,
  cfg: { scale: [number, number]; opacity: [number, number]; spread: number },
): FogLayerSlot[] {
  const out: FogLayerSlot[] = []

  for (let i = 0; i < veilCount; i++) {
    out.push({
      ox: (i - (veilCount - 1) / 2) * 0.05,
      oy: ((i % 2) * 2 - 1) * 0.04,
      scale: 1.02 + i * 0.04,
      phase: i * 2.1,
      baseOpacity: cfg.opacity[1] * (0.9 + i * 0.06),
      rot: i * 28,
    })
  }

  for (let i = 0; i < count; i++) {
    const angle = i * 2.399963
    const dist = cfg.spread * Math.sqrt((i + 1) / (count + 1))
    const mix = ((i * 7) % 10) / 10
    out.push({
      ox: Math.cos(angle) * dist,
      oy: Math.sin(angle) * dist,
      scale: cfg.scale[0] + mix * (cfg.scale[1] - cfg.scale[0]),
      phase: i * 0.58 + angle,
      baseOpacity: cfg.opacity[0] + mix * (cfg.opacity[1] - cfg.opacity[0]),
      rot: (i * 41 + 11) % 72 - 36,
    })
  }

  return out
}

const POISON_BACK_PARTICLES = buildPoisonFogLayer(16, 3, {
  scale: [0.62, 0.98],
  opacity: [0.18, 0.32],
  spread: 0.36,
})

const POISON_FRONT_PARTICLES = buildPoisonFogLayer(20, 3, {
  scale: [0.55, 0.92],
  opacity: [0.17, 0.28],
  spread: 0.4,
})

/** 雾气团整体透明度呼吸：60% ↔ 30%，各约 2 秒（完整周期 4 秒） */
function poisonFogPulseOpacity(t: number): number {
  return 0.45 + 0.15 * Math.cos(t * (Math.PI / 2))
}

function animateFogLayer(
  node: Konva.Circle,
  slot: FogLayerSlot,
  radius: number,
  t: number,
  opacityMul: number,
) {
  const breathe = 1 + Math.sin(t * 0.45 + slot.phase) * 0.03
  const r = radius * slot.scale * breathe
  const driftX = Math.sin(t * 0.32 + slot.phase) * radius * 0.04
  const driftY = Math.cos(t * 0.26 + slot.phase * 0.85) * radius * 0.03
  const rot = slot.rot + Math.sin(t * 0.18 + slot.phase) * 6

  node.x(slot.ox * radius + driftX)
  node.y(slot.oy * radius + driftY)
  node.radius(r)
  node.fillRadialGradientEndRadius(r)
  node.rotation(rot)
  node.opacity(slot.baseOpacity * opacityMul)
}

/** 毒云：径向渐变雾团叠加，各自慢速飘动 */
function PoisonSmokeParticles({
  radius,
  particles,
  opacityMul = 1,
}: {
  radius: number
  particles: FogLayerSlot[]
  opacityMul?: number
}) {
  const groupRef = useRef<Konva.Group>(null)
  const particleRefs = useRef<(Konva.Circle | null)[]>([])

  useStatusAnimation(
    () => groupRef.current?.getLayer() ?? null,
    (frame) => {
      const group = groupRef.current
      if (!group) return
      const t = (frame?.time ?? 0) / 1000
      group.opacity(poisonFogPulseOpacity(t))
      particleRefs.current.forEach((node, i) => {
        if (!node) return
        animateFogLayer(node, particles[i], radius, t, opacityMul)
      })
    },
    [radius, particles, opacityMul],
  )

  return (
    <Group
      ref={groupRef}
      opacity={0.6}
      listening={false}
      clipFunc={(ctx) => {
        ctx.arc(0, 0, radius, 0, Math.PI * 2, false)
      }}
    >
      {particles.map((slot, i) => {
        const r = radius * slot.scale
        return (
          <Circle
            key={i}
            ref={(el) => {
              particleRefs.current[i] = el
            }}
            x={slot.ox * radius}
            y={slot.oy * radius}
            radius={r}
            rotation={slot.rot}
            fillRadialGradientStartPoint={{ x: 0, y: 0 }}
            fillRadialGradientStartRadius={0}
            fillRadialGradientEndPoint={{ x: 0, y: 0 }}
            fillRadialGradientEndRadius={r}
            fillRadialGradientColorStops={POISON_MIST_GRADIENT}
            opacity={slot.baseOpacity * opacityMul}
            listening={false}
          />
        )
      })}
    </Group>
  )
}

/** 毒云底层雾（token 下方，可与燃烧叠加） */
function PoisonCloudGlow({ radius }: { radius: number }) {
  return <PoisonSmokeParticles radius={radius} particles={POISON_BACK_PARTICLES} opacityMul={1.1} />
}

/** 毒云粒子（token 上方，可与火焰叠加） */
function PoisonCloud({ radius }: { radius: number }) {
  return <PoisonSmokeParticles radius={radius} particles={POISON_FRONT_PARTICLES} opacityMul={1} />
}
