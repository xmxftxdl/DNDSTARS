import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Gauge, Zap, Plus, Trash2, SkipForward, X, Timer, Crosshair, Infinity } from 'lucide-react'
import { useCharacterStore } from '../../store/characters'
import QiIndicator from '../map/QiIndicator'
import { isShadowDancer } from '../../lib/characterClasses'
import type { CombatSkill } from '../../types/character'
import { MAX_COOLDOWN } from '../../types/character'
import { KNOCKBACK_ICON } from '../../lib/knockback'

const EMOJI_CHOICES = ['✨', '🔥', '❄️', '⚡', '🗡️', '⚔️', '🛡️', '🏹', '💨', '🌀', '☠️', '📢', '🩸', '🌙']

function damageText(s: CombatSkill): string | null {
  if (s.damageCount <= 0) return null
  return `${s.damageCount}d${s.damageSides}${s.damageBonus ? `+${s.damageBonus}` : ''}`
}

export interface InfiniteAction {
  id: string
  name: string
  icon: ReactNode
  detail: string
  disabled?: boolean
  used?: boolean
  disabledLabel?: string
  usedLabel?: string
  onUse: () => void
}

export default function SkillBar({
  charId,
  hideTurnControls = false,
  fillHeight = false,
  scrollColumns = false,
  extraInfiniteActions = [],
  onUseSkill,
  onQiReduceSkill,
  canAct = true,
}: {
  charId: string
  hideTurnControls?: boolean
  fillHeight?: boolean
  /** 横向滚动 + 加宽列（用于地图浮层） */
  scrollColumns?: boolean
  extraInfiniteActions?: InfiniteAction[]
  /** 提供时，点「使用」会回调（用于先选目标/掷骰），而非直接结算 */
  onUseSkill?: (skill: CombatSkill) => void
  onQiReduceSkill?: (skill: CombatSkill) => void
  canAct?: boolean
}) {
  const character = useCharacterStore((s) => s.characters.find((c) => c.id === charId))
  const useSkill = useCharacterStore((s) => s.useSkill)
  const endTurn = useCharacterStore((s) => s.endTurn)
  const reduceCooldown = useCharacterStore((s) => s.reduceCooldown)
  const useQiReduceCooldown = useCharacterStore((s) => s.useQiReduceCooldown)
  const addSkill = useCharacterStore((s) => s.addSkill)
  const updateSkill = useCharacterStore((s) => s.updateSkill)
  const removeSkill = useCharacterStore((s) => s.removeSkill)

  const [editingId, setEditingId] = useState<string | null>(null)
  const xScrollRef = useRef<HTMLDivElement | null>(null)
  const xDragRef = useRef<{
    pointerId: number
    startX: number
    startScrollLeft: number
    dragging: boolean
  } | null>(null)

  if (!character) return null
  const c = character
  const shadowDancer = isShadowDancer(c.charClass)
  const canSpendQi = shadowDancer && (c.qi ?? 0) > 0
  const editing = c.combatSkills.find((s) => s.id === editingId) ?? null
  const effectiveCd = (s: CombatSkill) =>
    s.cooldown <= 0 ? 0 : Math.max(1, s.cooldown - s.cdReduction)
  const isInfiniteSkill = (s: CombatSkill) =>
    s.skillTreeId === 'basicShot' || s.name === '基础射击' || s.cooldown <= 0
  const columns = Array.from({ length: MAX_COOLDOWN + 1 }, (_, i) => i)
  const infiniteSkills = c.combatSkills.filter(isInfiniteSkill)

  const handleDeleteSkill = (skill: CombatSkill) => {
    if (skill.skillTreeId) return
    if (!confirm(`删除技能「${skill.name}」？`)) return
    removeSkill(charId, skill.id)
    if (editingId === skill.id) setEditingId(null)
  }

  const startColumnDragScroll = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scrollColumns || event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('button,input,textarea,select,a')) return
    const el = xScrollRef.current
    if (!el) return
    xDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: el.scrollLeft,
      dragging: false,
    }
    el.setPointerCapture?.(event.pointerId)
  }

  const moveColumnDragScroll = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = xDragRef.current
    const el = xScrollRef.current
    if (!drag || !el || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    if (Math.abs(dx) > 3) drag.dragging = true
    if (!drag.dragging) return
    event.preventDefault()
    el.scrollLeft = drag.startScrollLeft - dx
  }

  const endColumnDragScroll = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = xDragRef.current
    const el = xScrollRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    el?.releasePointerCapture?.(event.pointerId)
    xDragRef.current = null
  }

  const handleColumnWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!scrollColumns) return
    const el = xScrollRef.current
    if (!el || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    const canScroll = el.scrollWidth > el.clientWidth
    if (!canScroll) return
    event.preventDefault()
    el.scrollLeft += event.deltaY
  }

  return (
    <div className={fillHeight ? 'flex h-full flex-col gap-3' : 'space-y-3'}>
      {/* 控制栏 */}
      <div className="glass flex shrink-0 flex-wrap items-center gap-3 rounded-2xl p-2.5">
        <div className="flex items-center gap-1.5 rounded-lg bg-sky-500/10 px-3 py-1.5">
          <Gauge className="h-4 w-4 text-sky-300" />
          <span className="text-sm text-slate-300">行动点</span>
          <span className="font-bold text-sky-200">
            {c.currentAP}
            <span className="text-slate-500">/{c.actionPoints}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5">
          <Zap className="h-4 w-4 text-amber-300" />
          <span className="text-sm text-slate-300">激励骰</span>
          <span className="font-bold text-amber-200">{c.inspiration}</span>
        </div>
        <QiIndicator charClass={c.charClass} level={c.level} qi={c.qi} />

        {!hideTurnControls && (
          <>
            <button
              type="button"
              onClick={() => endTurn(charId)}
              className="ml-auto flex items-center gap-2 rounded-xl bg-arcane-500/20 px-4 py-2 text-sm font-semibold text-arcane-100 transition-colors hover:bg-arcane-500/30"
              title="所有技能冷却 -1"
            >
              <SkipForward className="h-4 w-4" />
              结束回合（冷却 -1）
            </button>
            <button
              type="button"
              onClick={() => addSkill(charId)}
              className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10"
            >
              <Plus className="h-4 w-4" />
              添加技能
            </button>
          </>
        )}
        {hideTurnControls && (
          <button
            type="button"
            onClick={() => addSkill(charId)}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10"
          >
            <Plus className="h-4 w-4" />
            添加技能
          </button>
        )}
        <span className="w-full text-center text-[10px] text-slate-500 sm:w-auto sm:text-left">右键技能可删除</span>
      </div>

      {/* ∞ + 0-7 冷却栏（∞ = 无冷却基础动作；0 = 本回合可用技能） */}
      <div
        className={[
          'rounded-2xl',
          scrollColumns ? 'p-1' : 'glass p-3',
          fillHeight ? 'min-h-0 flex-1' : '',
        ].join(' ')}
      >
        <div
          ref={xScrollRef}
          onPointerDown={startColumnDragScroll}
          onPointerMove={moveColumnDragScroll}
          onPointerUp={endColumnDragScroll}
          onPointerCancel={endColumnDragScroll}
          onWheel={handleColumnWheel}
          className={
            scrollColumns
              ? 'skillbar-x-scroll flex cursor-grab touch-pan-y select-none gap-2 overflow-x-auto overscroll-contain pb-2 active:cursor-grabbing'
              : `grid grid-cols-4 gap-2 sm:grid-cols-9 ${fillHeight ? 'h-full' : ''}`
          }
        >
          <div
            className={[
              'flex min-h-0 flex-col rounded-xl border border-cyan-500/30 bg-cyan-500/[0.05] p-1.5',
              scrollColumns ? 'w-40 shrink-0' : '',
            ].join(' ')}
          >
            <div className="mb-1.5 flex items-center justify-center gap-1 text-center text-xs font-bold text-cyan-200">
              <Infinity className="h-3.5 w-3.5" />
              无限
            </div>
            <div
              className={`space-y-1.5 ${
                fillHeight ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain' : scrollColumns ? 'max-h-44 overflow-y-auto overscroll-contain' : 'max-h-72 overflow-y-auto overscroll-contain'
              }`}
            >
              {infiniteSkills.map((s) => (
                <ReadySkill
                  key={s.id}
                  skill={s}
                  canUse={canAct && !s.usedThisTurn && c.currentAP >= s.apCost}
                  notEnoughAP={c.currentAP < s.apCost}
                  disabledLabel={!canAct ? '未到回合' : undefined}
                  effectiveCd={effectiveCd(s)}
                  onEdit={() => setEditingId(s.id)}
                  onUse={() => (onUseSkill ? onUseSkill(s) : useSkill(charId, s.id))}
                  onDelete={() => handleDeleteSkill(s)}
                />
              ))}
              {extraInfiniteActions.map((action) => (
                <InfiniteActionCard key={action.id} action={action} />
              ))}
            </div>
          </div>
          {columns.map((col) => {
            const inCol = c.combatSkills.filter((s) => !isInfiniteSkill(s) && s.remaining === col)
            const isReady = col === 0
            return (
              <div
                key={col}
                className={[
                  'flex min-h-0 flex-col rounded-xl border p-1.5',
                  scrollColumns ? 'w-40 shrink-0' : '',
                  isReady ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-white/10 bg-void-900/30',
                ].join(' ')}
              >
                <div className={`mb-1.5 text-center text-xs font-bold ${isReady ? 'text-emerald-300' : 'text-slate-500'}`}>
                  {isReady ? '0 · 可用' : col}
                </div>
                <div
                  className={`space-y-1.5 ${
                    fillHeight ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain' : scrollColumns ? 'max-h-44 overflow-y-auto overscroll-contain' : 'max-h-72 overflow-y-auto overscroll-contain'
                  }`}
                >
                  {inCol.map((s) =>
                    isReady ? (
                      <ReadySkill
                        key={s.id}
                        skill={s}
                        canUse={canAct && !s.usedThisTurn && c.currentAP >= s.apCost}
                        notEnoughAP={c.currentAP < s.apCost}
                        disabledLabel={!canAct ? '未到回合' : undefined}
                        effectiveCd={effectiveCd(s)}
                        onEdit={() => setEditingId(s.id)}
                        onUse={() => (onUseSkill ? onUseSkill(s) : useSkill(charId, s.id))}
                        onDelete={() => handleDeleteSkill(s)}
                      />
                    ) : (
                      <CoolingSkill
                        key={s.id}
                        skill={s}
                        canReduce={c.inspiration > 0}
                        canQiReduce={canAct && canSpendQi}
                        onEdit={() => setEditingId(s.id)}
                        onReduce={() => reduceCooldown(charId, s.id)}
                        onQiReduce={() => (onQiReduceSkill ? onQiReduceSkill(s) : useQiReduceCooldown(charId, s.id))}
                        onDelete={() => handleDeleteSkill(s)}
                      />
                    ),
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 技能编辑器 */}
      {editing && (
        <div className="glass shrink-0 rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">编辑技能</p>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-white/5"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
            <div className="space-y-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">名称</span>
                <input
                  value={editing.name}
                  onChange={(e) => updateSkill(charId, editing.id, { name: e.target.value })}
                  className="rounded-lg border border-white/10 bg-void-900/60 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-arcane-500"
                />
              </label>
              <div>
                <span className="text-xs text-slate-500">图标</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {EMOJI_CHOICES.map((emoji) => (
                    <button
                      type="button"
                      key={emoji}
                      onClick={() => updateSkill(charId, editing.id, { emoji })}
                      className={[
                        'flex h-8 w-8 items-center justify-center rounded-md text-base transition-colors',
                        editing.emoji === emoji ? 'bg-arcane-500/30' : 'hover:bg-white/10',
                      ].join(' ')}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <NumberField
                  label="行动点消耗"
                  value={editing.apCost}
                  onChange={(v) => updateSkill(charId, editing.id, { apCost: v })}
                />
                <NumberField
                  label="冷却回合"
                  value={editing.cooldown}
                  min={1}
                  max={MAX_COOLDOWN}
                  onChange={(v) => updateSkill(charId, editing.id, { cooldown: v })}
                />
                <NumberField
                  label="装备冷却减免"
                  value={editing.cdReduction}
                  onChange={(v) => updateSkill(charId, editing.id, { cdReduction: v })}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <NumberField
                  label="伤害骰个数"
                  value={editing.damageCount}
                  onChange={(v) => updateSkill(charId, editing.id, { damageCount: v })}
                />
                <NumberField
                  label="骰子面数 (dX)"
                  value={editing.damageSides}
                  min={2}
                  onChange={(v) => updateSkill(charId, editing.id, { damageSides: v })}
                />
                <NumberField
                  label="固定加值"
                  value={editing.damageBonus}
                  onChange={(v) => updateSkill(charId, editing.id, { damageBonus: v })}
                />
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">描述</span>
                <textarea
                  value={editing.description}
                  onChange={(e) => updateSkill(charId, editing.id, { description: e.target.value })}
                  rows={2}
                  className="resize-none rounded-lg border border-white/10 bg-void-900/60 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-arcane-500"
                />
              </label>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  有效冷却 = max(1, {editing.cooldown} - {editing.cdReduction}) ={' '}
                  <span className="font-semibold text-arcane-300">{effectiveCd(editing)}</span> 回合
                </span>
                <button
                  type="button"
                  onClick={() => {
                    removeSkill(charId, editing.id)
                    setEditingId(null)
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-rose-500/15 px-3 py-1.5 text-sm font-medium text-rose-300 transition-colors hover:bg-rose-500/25"
                >
                  <Trash2 className="h-4 w-4" />
                  删除技能
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ReadySkill({
  skill,
  canUse,
  notEnoughAP,
  disabledLabel,
  effectiveCd,
  onEdit,
  onUse,
  onDelete,
}: {
  skill: CombatSkill
  canUse: boolean
  notEnoughAP: boolean
  disabledLabel?: string
  effectiveCd: number
  onEdit: () => void
  onUse: () => void
  onDelete: () => void
}) {
  const dmg = damageText(skill)
  return (
    <div
      className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-1.5"
      onContextMenu={(e) => {
        e.preventDefault()
        onDelete()
      }}
    >
      <button type="button" onClick={onEdit} className="flex w-full items-center gap-1.5 text-left">
        <span className="text-lg">{skill.emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-slate-100">{skill.name}</span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-slate-400">
            <span className="text-sky-300">行{skill.apCost}</span>
            <span className="flex items-center gap-0.5">
              <Timer className="h-2.5 w-2.5" />
              {skill.cooldown <= 0 ? '—' : effectiveCd}
            </span>
            {dmg && <span className="text-rose-300">{dmg}</span>}
            {skill.knockbackOnHit && (
              <img
                src={KNOCKBACK_ICON}
                alt="击飞"
                title="命中：敏捷豁免失败则被击飞"
                className="h-3.5 w-3.5 shrink-0"
              />
            )}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onUse}
        disabled={!canUse}
        className={[
          'mt-1 flex w-full items-center justify-center gap-1 rounded-md py-1 text-xs font-semibold transition-colors',
          canUse ? 'bg-emerald-500/25 text-emerald-200 hover:bg-emerald-500/40' : 'cursor-not-allowed bg-white/5 text-slate-600',
        ].join(' ')}
      >
        {skill.usedThisTurn ? '已用' : disabledLabel ?? (notEnoughAP ? '行动点不足' : (
          <>
            {dmg && <Crosshair className="h-3 w-3" />}
            {dmg ? '释放' : '使用'}
          </>
        ))}
      </button>
    </div>
  )
}

function CoolingSkill({
  skill,
  canReduce,
  canQiReduce,
  onEdit,
  onReduce,
  onQiReduce,
  onDelete,
}: {
  skill: CombatSkill
  canReduce: boolean
  canQiReduce?: boolean
  onEdit: () => void
  onReduce: () => void
  onQiReduce?: () => void
  onDelete: () => void
}) {
  return (
    <div
      className="rounded-lg border border-rose-500/20 bg-rose-500/[0.06] p-1.5 text-center"
      onContextMenu={(e) => {
        e.preventDefault()
        onDelete()
      }}
    >
      <button type="button" onClick={onEdit} className="block w-full">
        <span className="block text-lg">{skill.emoji}</span>
        <span className="block truncate text-[11px] text-slate-300">{skill.name}</span>
      </button>
      <div className="mt-1 flex gap-1">
        <button
          type="button"
          onClick={onReduce}
          disabled={!canReduce}
          title="用激励骰使冷却 -1"
          className={[
            'flex flex-1 items-center justify-center gap-0.5 rounded py-0.5 text-[10px] font-semibold transition-colors',
            canReduce ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'cursor-not-allowed bg-white/5 text-slate-600',
          ].join(' ')}
        >
          <Zap className="h-3 w-3" />
          -1
        </button>
        {onQiReduce && (
          <button
            type="button"
            onClick={onQiReduce}
            disabled={!canQiReduce}
            title="消耗 1 点气使冷却 -1（每技能每回合最多 1 次）"
            className={[
              'flex flex-1 items-center justify-center rounded py-0.5 text-[10px] font-semibold transition-colors',
              canQiReduce ? 'bg-violet-500/20 text-violet-200 hover:bg-violet-500/30' : 'cursor-not-allowed bg-white/5 text-slate-600',
            ].join(' ')}
          >
            气
          </button>
        )}
      </div>
    </div>
  )
}

function InfiniteActionCard({ action }: { action: InfiniteAction }) {
  const disabled = !!action.disabled || !!action.used
  const label = action.used
    ? action.usedLabel ?? '已启用'
    : action.disabled
      ? action.disabledLabel ?? '不可用'
      : '使用'

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] p-1.5">
      <div className="flex w-full items-center gap-1.5 text-left">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/5 text-cyan-200">
          {action.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-slate-100">{action.name}</span>
          <span className="block truncate text-[10px] text-slate-400">{action.detail}</span>
        </span>
      </div>
      <button
        type="button"
        onClick={action.onUse}
        disabled={disabled}
        className={[
          'mt-1 flex w-full items-center justify-center rounded-md py-1 text-xs font-semibold transition-colors',
          disabled ? 'cursor-not-allowed bg-white/5 text-slate-600' : 'bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30',
        ].join(' ')}
      >
        {label}
      </button>
    </div>
  )
}

function NumberField({
  label,
  value,
  min = 0,
  max = 99,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        className="rounded-lg border border-white/10 bg-void-900/60 px-3 py-1.5 text-sm text-slate-200 outline-none focus:border-arcane-500"
      />
    </label>
  )
}
