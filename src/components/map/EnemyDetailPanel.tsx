import ProcessedIcon from '../ProcessedIcon'
import TokenStatusEditor from './TokenStatusEditor'
import type { Token } from '../../store/maps'
import type { Character } from '../../types/character'
import { ABILITIES, abilityMod, formatMod } from '../../lib/dnd'
import { getEnemyTemplate, type EnemyTemplate } from '../../lib/enemyPool'
import { getEnemyStatBlock, type EnemyStatBlock } from '../../lib/enemyStatBlocks'
import {
  getEnemyDerivedCombatStats,
  getEnemyEquipmentSlots,
} from '../../lib/enemyCombatStats'
import { X, Shield, Footprints, Sparkles, Swords, Backpack } from 'lucide-react'

function resolveEnemyDetail(token: Token): {
  template: EnemyTemplate | undefined
  stats: EnemyStatBlock | undefined
} {
  const template = token.poolId ? getEnemyTemplate(token.poolId) : undefined
  const stats = token.poolId ? getEnemyStatBlock(token.poolId) : undefined
  return { template, stats }
}

export default function EnemyDetailPanel({
  token,
  onClose,
  isDM = false,
  mapId,
  characters = [],
  updateToken,
  updateChar,
  removeToken,
}: {
  token: Token
  onClose: () => void
  closable?: boolean
  isDM?: boolean
  mapId?: string
  characters?: Character[]
  updateToken?: (mapId: string, tokenId: string, patch: Partial<Token>) => void
  updateChar?: (charId: string, patch: Partial<Character>) => void
  removeToken?: (mapId: string, tokenId: string) => void
}) {
  const { template, stats } = resolveEnemyDetail(token)
  const derived = token.poolId ? getEnemyDerivedCombatStats(token.poolId) : undefined
  const maxHp = token.maxHp ?? derived?.maxHp ?? template?.maxHp ?? 20
  const curHp = token.hp ?? maxHp
  const hpPct = maxHp > 0 ? Math.max(0, Math.min(100, (curHp / maxHp) * 100)) : 0

  const name = token.label || template?.name || '敌人'
  const emoji = token.emoji || template?.emoji || '👹'
  const color = token.color || template?.color || '#f87171'
  const tags = template?.tags ?? []
  const description = template?.description
  const linked = token.characterId ? characters.find((c) => c.id === token.characterId) : undefined
  const canEdit = isDM && !!mapId && !!updateToken

  return (
    <div className="glass absolute bottom-3 right-3 z-40 flex max-h-[min(720px,calc(100%-6rem))] w-[min(340px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
      <div className="flex items-start gap-3 border-b border-white/10 px-4 py-3">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 bg-void-900 text-2xl"
          style={{ borderColor: color }}
        >
          {emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-slate-100">{name}</h2>
            {stats && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                CR {stats.cr}
              </span>
            )}
          </div>
          {tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span key={tag} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        {(
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-200"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {canEdit && (
          <section className="mb-4 rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="grid grid-cols-[auto,1fr] items-center gap-2">
              <span className="text-xs text-slate-500">名称</span>
              <input
                value={token.label}
                onChange={(e) => updateToken!(mapId!, token.id, { label: e.target.value })}
                className="rounded-lg border border-white/10 bg-void-950/70 px-2 py-1 text-xs text-slate-100 outline-none focus:border-arcane-500"
              />
              <span className="text-xs text-slate-500">大小</span>
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.25}
                value={token.size ?? 1}
                onChange={(e) => updateToken!(mapId!, token.id, { size: Number(e.target.value) })}
                className="accent-arcane-500"
              />
              <span className="text-xs text-slate-500">HP</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  value={linked?.currentHp ?? curHp}
                  onChange={(e) => {
                    const nextHp = Math.max(0, Number(e.target.value) || 0)
                    if (linked && updateChar) {
                      updateChar(linked.id, { currentHp: Math.min(linked.maxHp, nextHp) })
                      updateToken!(mapId!, token.id, { hp: Math.min(linked.maxHp, nextHp), maxHp: linked.maxHp })
                    } else {
                      updateToken!(mapId!, token.id, { hp: Math.min(maxHp, nextHp) })
                    }
                  }}
                  className="w-16 rounded border border-white/10 bg-void-950/70 px-1 py-0.5 text-center text-xs text-slate-100 outline-none focus:border-arcane-500"
                />
                <span className="text-xs text-slate-500">/</span>
                <input
                  type="number"
                  min={1}
                  value={linked?.maxHp ?? maxHp}
                  onChange={(e) => {
                    const nextMax = Math.max(1, Number(e.target.value) || 1)
                    if (linked && updateChar) {
                      updateChar(linked.id, { maxHp: nextMax, currentHp: Math.min(linked.currentHp, nextMax) })
                      updateToken!(mapId!, token.id, { hp: Math.min(linked.currentHp, nextMax), maxHp: nextMax })
                    } else {
                      updateToken!(mapId!, token.id, { maxHp: nextMax, hp: Math.min(curHp, nextMax) })
                    }
                  }}
                  className="w-16 rounded border border-white/10 bg-void-950/70 px-1 py-0.5 text-center text-xs text-slate-100 outline-none focus:border-arcane-500"
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={token.showHpOnToken !== false}
                  onChange={(e) => updateToken!(mapId!, token.id, { showHpOnToken: e.target.checked })}
                  className="accent-arcane-500"
                />
                玩家可见血条
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={token.showDetailOnToken !== false}
                  onChange={(e) => updateToken!(mapId!, token.id, { showDetailOnToken: e.target.checked })}
                  className="accent-arcane-500"
                />
                玩家可见详情
              </label>
              <TokenStatusEditor mapId={mapId!} token={token} updateToken={updateToken!} />
              {removeToken && (
                <button
                  type="button"
                  onClick={() => {
                    removeToken(mapId!, token.id)
                    onClose()
                  }}
                  className="rounded-lg bg-rose-500/15 px-2 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/25"
                >
                  删除
                </button>
              )}
            </div>
          </section>
        )}
        {/* 生命值 */}
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-rose-300">生命值</span>
            <span className="tabular-nums text-slate-300">
              {curHp} / {maxHp}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-void-900/80">
            <div
              className="h-full rounded-full bg-gradient-to-r from-rose-600 to-rose-400 transition-all"
              style={{ width: `${hpPct}%` }}
            />
          </div>
        </div>

        {description && (
          <p className="mb-4 text-sm leading-relaxed text-slate-400">{description}</p>
        )}

        {!stats ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/5 px-3 py-6 text-center">
            <p className="text-sm text-slate-400">该敌人尚未关联怪物种类</p>
            <p className="mt-1 text-xs text-slate-500">DM 可通过「添加怪物」为其指定种类</p>
          </div>
        ) : (
          <>
            {/* 基础数据 */}
            <div className="mb-4 grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                <Shield className="h-4 w-4 text-sky-400" />
                <div>
                  <p className="text-[10px] text-slate-500">AC</p>
                  <p className="text-sm font-semibold text-slate-100">{derived?.ac ?? stats.ac}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                <Footprints className="h-4 w-4 text-emerald-400" />
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-500">速度</p>
                  <p className="truncate text-sm font-semibold text-slate-100">{stats.speed}</p>
                </div>
              </div>
            </div>

            {derived && (
              <section className="mb-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">战斗属性</h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: '攻击力', value: derived.physicalAttack },
                    { label: '防御力', value: derived.defense },
                    { label: '魔法攻击', value: derived.magicAttack },
                    { label: '魔法防御', value: derived.magicDefense },
                    { label: '生命上限', value: derived.maxHp },
                    { label: '暴击伤害', value: derived.critDamagePercent },
                  ].map((row) => (
                    <div key={row.label} className="rounded-xl bg-arcane-500/10 px-3 py-2">
                      <p className="text-[10px] text-slate-500">{row.label}</p>
                      <p className="text-sm font-semibold text-arcane-200">{row.value}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* [T6/B1] 主攻击命中 + 伤害：对所有怪物渲染（含 ogre/owlbear 等无装备怪）。 */}
            {derived?.damageDice && (
              <section className="mb-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <Swords className="h-3.5 w-3.5" />
                  主攻击
                </h3>
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-rose-500/10 px-3 py-2">
                  {derived.attackName && (
                    <span className="text-sm font-medium text-rose-200">{derived.attackName}</span>
                  )}
                  {derived.toHit != null && (
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs tabular-nums text-slate-200">
                      命中 {derived.toHit >= 0 ? `+${derived.toHit}` : derived.toHit}
                    </span>
                  )}
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs tabular-nums text-slate-200">
                    伤害 {derived.damageDice}
                  </span>
                </div>
              </section>
            )}

            {token.poolId && getEnemyEquipmentSlots(token.poolId).some((s) => s.name) && (
              <section className="mb-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <Backpack className="h-3.5 w-3.5" />
                  装备
                </h3>
                <ul className="space-y-1.5">
                  {getEnemyEquipmentSlots(token.poolId)
                    .filter((s) => s.name)
                    .map((s) => (
                      <li key={s.slot} className="rounded-xl bg-amber-500/10 px-3 py-2">
                        <p className="text-[10px] text-slate-500">{s.label}</p>
                        <p className="text-sm font-medium text-amber-100">{s.name}</p>
                        {s.stats ? <p className="mt-0.5 text-[11px] text-slate-500">{s.stats}</p> : null}
                      </li>
                    ))}
                </ul>
              </section>
            )}

            {/* 六维属性 */}
            <section className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">属性</h3>
              <div className="grid grid-cols-3 gap-2">
                {ABILITIES.map(({ key, label }) => {
                  const score = stats.abilities[key]
                  const mod = abilityMod(score)
                  return (
                    <div
                      key={key}
                      className="flex flex-col items-center rounded-xl border border-white/5 bg-void-900/40 px-2 py-2"
                    >
                      <span className="text-[10px] font-medium text-slate-500">{label}</span>
                      <span className="text-lg font-bold text-arcane-200">{formatMod(mod)}</span>
                      <span className="text-[10px] tabular-nums text-slate-500">{score}</span>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* 技能 / 感官 / 语言 */}
            {(stats.skills?.length || stats.senses || stats.languages) && (
              <section className="mb-4 space-y-1.5 text-xs text-slate-400">
                {stats.skills?.map((s) => (
                  <p key={s.name}>
                    <span className="text-slate-500">技能 · </span>
                    {s.name} {s.bonus}
                  </p>
                ))}
                {stats.senses && (
                  <p>
                    <span className="text-slate-500">感官 · </span>
                    {stats.senses}
                  </p>
                )}
                {stats.languages && (
                  <p>
                    <span className="text-slate-500">语言 · </span>
                    {stats.languages}
                  </p>
                )}
              </section>
            )}

            {/* 特性 */}
            {stats.traits.length > 0 && (
              <section className="mb-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <Sparkles className="h-3.5 w-3.5" />
                  特性
                </h3>
                <ul className="space-y-2">
                  {stats.traits.map((t) => (
                    <li key={t.name} className="rounded-xl bg-violet-500/10 px-3 py-2">
                      <p className="text-sm font-medium text-violet-200">{t.name}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{t.description}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* 动作 */}
            {stats.actions.length > 0 && (
              <section className="mb-2">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <Swords className="h-3.5 w-3.5" />
                  动作
                </h3>
                <ul className="space-y-2">
                  {stats.actions.map((a) => (
                    <li key={a.name} className="rounded-xl bg-rose-500/10 px-3 py-2">
                      <p className="text-sm font-medium text-rose-200">{a.name}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{a.description}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {(token.knockbackTurns ?? 0) > 0 && (
          <p className="mt-2 rounded-lg bg-sky-500/15 px-2 py-1 text-xs text-sky-200">
            <ProcessedIcon
              knockback
              src="/icons/knockback.png"
              className="mr-1 inline h-3.5 w-3.5 align-[-2px] object-contain"
              fallback="⬆"
            />
            击飞 {token.knockbackTurns} 回合
          </p>
        )}
        {(token.burningTurns ?? 0) > 0 && (
          <p className="mt-3 rounded-lg bg-orange-500/15 px-2 py-1 text-xs text-orange-300">
            🔥 燃烧 {token.burningTurns} 回合
          </p>
        )}
        {(token.igniteTurns ?? 0) > 0 && (
          <p className="mt-2 rounded-lg bg-red-500/15 px-2 py-1 text-xs text-red-300">
            <ProcessedIcon
              ignite
              src="/icons/ignite.png"
              className="mr-1 inline h-3.5 w-3.5 align-[-2px] object-contain"
              fallback="🔥"
            />
            点燃 {token.igniteTurns} 回合
          </p>
        )}
        {(token.poisonTurns ?? 0) > 0 && (
          <p className="mt-2 rounded-lg bg-lime-500/15 px-2 py-1 text-xs text-lime-300">
            <ProcessedIcon
              poison
              src="/icons/poison.png"
              className="mr-1 inline h-3.5 w-3.5 align-[-2px] object-contain"
              fallback="☠️"
            />
            中毒 {token.poisonTurns} 回合
          </p>
        )}
        {(token.stunTurns ?? 0) > 0 && (
          <p className="mt-2 rounded-lg bg-yellow-500/15 px-2 py-1 text-xs text-yellow-200">
            ★ 眩晕 {token.stunTurns} 回合
          </p>
        )}
        {/* [T4/C5] restrained/vulnerable/no-move were authoritative on the token but never
            shown in the enemy panel — display them from the same *Turns source (no drift). */}
        {(token.restrainedTurns ?? 0) > 0 && (
          <p className="mt-2 rounded-lg bg-orange-500/15 px-2 py-1 text-xs text-orange-200">
            🕸 束缚 {token.restrainedTurns} 回合
          </p>
        )}
        {(token.vulnerableTurns ?? 0) > 0 && (
          <p className="mt-2 rounded-lg bg-rose-500/15 px-2 py-1 text-xs text-rose-200">
            💔 脆弱 {token.vulnerableTurns} 回合
          </p>
        )}
        {(token.noMoveTurns ?? 0) > 0 && (
          <p className="mt-2 rounded-lg bg-slate-500/15 px-2 py-1 text-xs text-slate-200">
            ⛓ 无法移动 {token.noMoveTurns} 回合
          </p>
        )}
      </div>
    </div>
  )
}

export function canShowEnemyDetail(token: Token): boolean {
  return token.type === 'enemy'
}
