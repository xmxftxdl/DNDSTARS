import { useState } from 'react'
import { ArrowUpCircle, Plus, Trash2, Sparkles } from 'lucide-react'
import { useCharacterStore } from '../../store/characters'
import {
  hasDarkvision,
  rollSkillCheck,
  wildernessPassiveAdvantage,
} from '../../lib/archerBaseFeatures'
import {
  canArmDoubleArrow,
  canUpgradeClassTrait,
  eagleEyeDexBonus,
  MAX_FEATURE_LEVEL,
  nextFeatureUpgradeCharacterLevel,
  pendingTraitChoices,
} from '../../lib/classFeatures'
import { formatFeatureDescription, getClassFeatureDef, usageLabel } from '../../lib/traitRegistry'
import { isCalmMindActive, isOutOfBreath } from '../../lib/calmMind'
import type { ClassFeatureKey } from '../../types/character'
import TraitChoicePanel from './TraitChoicePanel'

const ACTIVE_FEATURES = new Set<ClassFeatureKey>([
  'trackingArrow',
  'shadowVeil',
  'stillWater',
  'finale',
  'illusionDance',
  'flexibleBody',
])

export default function FeaturesTab({
  charId,
  isDM,
  battleMode = false,
  isPlayerTurn = false,
  onActivateFeature,
  allowUpgrade = true,
}: {
  charId: string
  isDM: boolean
  battleMode?: boolean
  isPlayerTurn?: boolean
  activeFeatureKey?: ClassFeatureKey | null
  onActivateFeature?: (key: ClassFeatureKey) => void | Promise<void>
  allowUpgrade?: boolean
}) {
  const c = useCharacterStore((s) => s.characters.find((x) => x.id === charId))
  const addTrait = useCharacterStore((s) => s.addTrait)
  const updateTrait = useCharacterStore((s) => s.updateTrait)
  const removeTrait = useCharacterStore((s) => s.removeTrait)
  const upgradeClassTrait = useCharacterStore((s) => s.upgradeClassTrait)
  const applyTraitChoice = useCharacterStore((s) => s.applyTraitChoice)
  const activateClassFeature = useCharacterStore((s) => s.activateClassFeature)
  const spendAP = useCharacterStore((s) => s.spendAP)
  const updateChar = useCharacterStore((s) => s.update)
  const [lastCheckLabel, setLastCheckLabel] = useState<string | null>(null)

  if (!c) return null

  const classTraits = c.traits.filter((t) => t.featureKey)
  const customTraits = c.traits.filter((t) => !t.featureKey)
  const pendingChoices = pendingTraitChoices(c)
  const eagleTurns = c.combatBuffs?.eagleEyeTurns ?? 0
  const doubleArrowReady = !!c.combatBuffs?.doubleArrowReady
  const preciseStrikeReady = !!c.combatBuffs?.preciseStrikeReady
  const galeComboReady = !!c.combatBuffs?.galeComboReady
  const agileLeapFeet = c.combatBuffs?.agileLeapMoveFeet ?? 0
  const wildernessBoost = !!c.combatBuffs?.wildernessGuideBoost

  const runWildernessCheck = (skillKey: 'survival' | 'perception') => {
    const isDaytime =
      skillKey === 'survival'
        ? window.confirm('当前是否为白天？\n确定 = 白天，取消 = 夜晚')
        : undefined
    const inWilderness =
      skillKey === 'perception'
        ? window.confirm('当前是否处于野外环境？')
        : undefined
    const passiveAdv = wildernessPassiveAdvantage(c, skillKey, {
      isDaytime: skillKey === 'survival' ? isDaytime : undefined,
      inWilderness: skillKey === 'perception' ? inWilderness : undefined,
    })
    const advantage = passiveAdv || wildernessBoost
    const result = rollSkillCheck(c, skillKey, { advantage })
    setLastCheckLabel(result.label)
    if (wildernessBoost) {
      updateChar(charId, {
        combatBuffs: { ...c.combatBuffs, wildernessGuideBoost: undefined },
      })
    }
  }

  const activateWildernessGuide = () => {
    const trait = c.traits.find((t) => t.featureKey === 'wildernessGuide')
    if (!trait || trait.uses <= 0) {
      alert('特殊指引次数已用完')
      return
    }
    if (!spendAP(charId, 1)) {
      alert('行动点不足（需要 1 AP）')
      return
    }
    if (!activateClassFeature(charId, 'wildernessGuide')) return
    updateChar(charId, {
      combatBuffs: { ...c.combatBuffs, wildernessGuideBoost: true },
    })
    alert('特殊指引已激活：下次生存或察觉检定具有优势')
  }
  const upgradePoints = c.featureUpgradePoints ?? 0
  const nextPointLevel = nextFeatureUpgradeCharacterLevel(c.level)

  return (
    <div className="space-y-5">
      {pendingChoices.map((group) => (
        <TraitChoicePanel
          key={group.id}
          group={group}
          onConfirm={(options) => applyTraitChoice(charId, group.id, options)}
        />
      ))}

      {classTraits.length > 0 && (
        <div className="glass rounded-2xl p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <Sparkles className="h-3.5 w-3.5 text-arcane-300" />
              职业特性
            </p>
            {upgradePoints > 0 && (
              <span className="rounded-lg bg-violet-500/20 px-3 py-1 text-sm font-bold tabular-nums text-violet-200">
                可用升级点 {upgradePoints}
              </span>
            )}
          </div>
          {upgradePoints === 0 && nextPointLevel != null && (
            <p className="mb-3 text-xs text-slate-500">
              角色升至 {nextPointLevel} 级可获得 1 个特性升级点（5 / 10 / 15 … 50 级各 1 点）
            </p>
          )}

          <div className="space-y-3">
            {classTraits.map((t) => {
              const canUpgrade = canUpgradeClassTrait(c, t)
              const def = t.featureKey ? getClassFeatureDef(t.featureKey) : undefined
              const usageSuffix = def ? usageLabel(def.usage) : t.maxUses > 0 ? '次/长休' : ''
              const eagleCanActivate = t.featureKey === 'eagleEye' ? t.uses > 0 && c.currentAP >= 1 : eagleTurns > 0 || t.uses > 0
              const displayDescription = def ? formatFeatureDescription(def, t.level) : t.description

              return (
                <div key={t.id} className="rounded-xl border border-emerald-500/25 bg-void-900/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold text-emerald-100">
                      {t.name}{' '}
                      <span className="text-base font-bold tabular-nums text-violet-300">LV{t.level}</span>
                    </h3>
                    {t.maxUses > 0 && usageSuffix && (
                      <span className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-sm font-bold tabular-nums text-emerald-200">
                        {t.uses} / {t.maxUses} {usageSuffix}
                      </span>
                    )}
                    {def?.usage === 'passive' && (
                      <span className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-slate-400">被动</span>
                    )}
                    {def?.usage === 'unlimited' && (
                      <span className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-slate-400">不限次数</span>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">{displayDescription}</p>

                  {allowUpgrade && canUpgrade && (
                    <button
                      type="button"
                      onClick={() => upgradeClassTrait(charId, t.id)}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500/20 px-3 py-2 text-sm font-semibold text-violet-100 transition-colors hover:bg-violet-500/30"
                    >
                      <ArrowUpCircle className="h-4 w-4" />
                      提升等级（消耗 1 升级点 → LV{t.level + 1}）
                    </button>
                  )}
                  {allowUpgrade && t.level >= MAX_FEATURE_LEVEL && (
                    <p className="mt-1.5 text-xs text-slate-500">该特性已达最高等级</p>
                  )}

                  {t.featureKey === 'doubleArrow' && doubleArrowReady && (
                    <p className="mt-2 text-xs font-semibold text-amber-200">双箭已就绪，等待单箭射击</p>
                  )}
                  {t.featureKey === 'eagleEye' && eagleTurns > 0 && (
                    <p className="mt-2 text-xs font-semibold text-sky-300">
                      鹰眼进行中：剩余 {eagleTurns} 回合 · 敏捷 +{eagleEyeDexBonus(t.level)}
                    </p>
                  )}
                  {t.featureKey === 'preciseStrike' && preciseStrikeReady && (
                    <p className="mt-2 text-xs font-semibold text-rose-300">精准打击已就绪</p>
                  )}
                  {t.featureKey === 'galeCombo' && galeComboReady && (
                    <p className="mt-2 text-xs font-semibold text-cyan-300">
                      疾风连击已就绪 · 下次技能/基础射击免 AP
                    </p>
                  )}
                  {t.featureKey === 'agileLeap' && agileLeapFeet > 0 && (
                    <p className="mt-2 text-xs font-semibold text-lime-300">
                      灵巧跳跃：点击地图移动至多 {agileLeapFeet} 尺
                    </p>
                  )}
                  {t.featureKey === 'wildernessGuide' && wildernessBoost && (
                    <p className="mt-2 text-xs font-semibold text-emerald-300">特殊指引已激活</p>
                  )}
                  {t.featureKey === 'wildernessGuide' && (
                    <div className="mt-3 space-y-2 rounded-lg border border-emerald-500/20 bg-void-900/40 p-3">
                      <p className="text-xs text-slate-400">
                        被动：白天生存检定优势；野外察觉检定优势
                        {hasDarkvision(c) ? '；夜晚生存检定优势（黑暗视觉）' : ''}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => runWildernessCheck('survival')}
                          className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/25"
                        >
                          生存检定
                        </button>
                        <button
                          type="button"
                          onClick={() => runWildernessCheck('perception')}
                          className="rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/25"
                        >
                          察觉检定
                        </button>
                        {t.maxUses > 0 && (
                          <button
                            type="button"
                            disabled={t.uses <= 0 || c.currentAP < 1}
                            onClick={activateWildernessGuide}
                            className="rounded-lg bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            特殊指引（{t.uses}/{t.maxUses}）
                          </button>
                        )}
                      </div>
                      {lastCheckLabel && t.featureKey === 'wildernessGuide' && (
                        <p className="text-xs font-medium text-arcane-200">{lastCheckLabel}</p>
                      )}
                    </div>
                  )}
                  {t.featureKey === 'calmMind' && isCalmMindActive(c) && (
                    <p className="mt-2 text-xs font-semibold text-teal-300">静心状态 · 伤害骰 +{t.level}D6</p>
                  )}
                  {t.featureKey === 'calmMind' && isOutOfBreath(c) && (
                    <p className="mt-2 text-xs font-semibold text-orange-300">
                      气喘状态 · 所有攻击获得劣势
                      {(c.combatBuffs?.outOfBreathTurns ?? 0) > 0 &&
                        ` · 剩余 ${c.combatBuffs!.outOfBreathTurns} 回合`}
                    </p>
                  )}

                  {battleMode && t.featureKey === 'doubleArrow' && isPlayerTurn && (
                    <button
                      type="button"
                      disabled={(!canArmDoubleArrow(c) || c.currentAP < 1) && !doubleArrowReady}
                      onClick={() => onActivateFeature?.('doubleArrow')}
                      className={[
                        'mt-3 w-full rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                        doubleArrowReady
                          ? 'bg-amber-500/25 text-amber-100 hover:bg-amber-500/35'
                          : canArmDoubleArrow(c) && c.currentAP >= 1
                            ? 'bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30'
                            : 'cursor-not-allowed bg-white/5 text-slate-600',
                      ].join(' ')}
                    >
                      {doubleArrowReady
                        ? '双箭已就绪 · 点击取消'
                        : t.uses > 0
                          ? `启用双箭（${t.uses}/${t.maxUses}）`
                          : '本场次数已用完'}
                    </button>
                  )}

                  {battleMode && t.featureKey === 'eagleEye' && isPlayerTurn && (
                    <button
                      type="button"
                      disabled={!eagleCanActivate}
                      onClick={() => onActivateFeature?.('eagleEye')}
                      className={[
                        'mt-3 w-full rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                        eagleCanActivate
                          ? 'bg-sky-500/20 text-sky-100 hover:bg-sky-500/30'
                          : 'cursor-not-allowed bg-white/5 text-slate-600',
                      ].join(' ')}
                    >
                      {eagleTurns > 0
                        ? `鹰眼进行中（${eagleTurns} 回合）· 再次激活刷新（${t.uses}/${t.maxUses}）`
                        : `激活鹰眼（3 回合 · ${t.uses}/${t.maxUses}）`}
                    </button>
                  )}

                  {battleMode && t.featureKey === 'preciseStrike' && isPlayerTurn && (
                    <button
                      type="button"
                      disabled={!preciseStrikeReady && (t.uses <= 0 || c.currentAP < 1)}
                      onClick={() => onActivateFeature?.('preciseStrike')}
                      className="mt-3 w-full rounded-lg bg-rose-500/20 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600"
                    >
                      {preciseStrikeReady
                        ? '精准打击已就绪 · 点击取消'
                        : c.currentAP < 1
                          ? '行动点不足（需要 1 AP）'
                          : `启用精准打击（1 AP · ${t.uses}/${t.maxUses}）`}
                    </button>
                  )}

                  {battleMode && t.featureKey && ACTIVE_FEATURES.has(t.featureKey) && isPlayerTurn && (
                    <button
                      type="button"
                      disabled={
                        t.featureKey === 'finale' && c.combatBuffs?.finaleReady
                          ? false
                          : c.currentAP < (t.featureKey === 'finale' ? 2 : 1) || (t.maxUses > 0 && t.uses <= 0)
                      }
                      onClick={() => onActivateFeature?.(t.featureKey!)}
                      className="mt-3 w-full rounded-lg bg-fuchsia-500/20 px-3 py-2 text-sm font-semibold text-fuchsia-100 hover:bg-fuchsia-500/30 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600"
                    >
                      {t.featureKey === 'finale' && c.combatBuffs?.finaleReady
                        ? '曲终待触发 · 点击取消'
                        : `激活（${t.featureKey === 'finale' ? 2 : 1} AP${t.maxUses > 0 ? ` · ${t.uses}/${t.maxUses}` : ''}）`}
                    </button>
                  )}

                  {isDM && t.maxUses > 0 && (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-xs text-slate-500">DM 调整剩余次数</span>
                      <input
                        type="number"
                        min={0}
                        max={t.maxUses}
                        value={t.uses}
                        onChange={(e) =>
                          updateTrait(charId, t.id, {
                            uses: Math.min(t.maxUses, Math.max(0, Number(e.target.value) || 0)),
                          })
                        }
                        className="w-16 rounded-md border border-white/10 bg-void-900/60 px-2 py-1 text-center text-sm text-slate-200 outline-none focus:border-arcane-500"
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="glass rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">其他特性</p>
          {isDM && (
            <button
              onClick={() => addTrait(charId)}
              className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10"
            >
              <Plus className="h-4 w-4" />
              添加特性
            </button>
          )}
        </div>

        {customTraits.length === 0 ? (
          <p className="py-3 text-center text-sm text-slate-500">
            {isDM ? '暂无自定义特性。' : '暂无其他特性。'}
          </p>
        ) : isDM ? (
          <div className="space-y-2">
            {customTraits.map((t) => (
              <div
                key={t.id}
                className="grid grid-cols-1 gap-2 rounded-lg bg-void-900/40 p-2 lg:grid-cols-[1.5fr_70px_90px_3fr_36px] lg:items-center"
              >
                <input
                  value={t.name}
                  onChange={(e) => updateTrait(charId, t.id, { name: e.target.value })}
                  className="rounded-md border border-white/10 bg-void-900/60 px-2 py-1 text-sm text-slate-200 outline-none focus:border-arcane-500"
                />
                <input
                  type="number"
                  value={t.level}
                  onChange={(e) => updateTrait(charId, t.id, { level: Number(e.target.value) || 0 })}
                  className="rounded-md border border-white/10 bg-void-900/60 px-2 py-1 text-center text-sm text-slate-200 outline-none focus:border-arcane-500"
                />
                <div className="flex items-center justify-center gap-1">
                  <input
                    type="number"
                    value={t.uses}
                    onChange={(e) => updateTrait(charId, t.id, { uses: Number(e.target.value) || 0 })}
                    className="w-10 rounded-md border border-white/10 bg-void-900/60 px-1 py-1 text-center text-sm text-slate-200 outline-none focus:border-arcane-500"
                  />
                  <span className="text-xs text-slate-500">/</span>
                  <input
                    type="number"
                    value={t.maxUses}
                    onChange={(e) => updateTrait(charId, t.id, { maxUses: Number(e.target.value) || 0 })}
                    className="w-10 rounded-md border border-white/10 bg-void-900/60 px-1 py-1 text-center text-sm text-slate-200 outline-none focus:border-arcane-500"
                  />
                </div>
                <input
                  value={t.description}
                  onChange={(e) => updateTrait(charId, t.id, { description: e.target.value })}
                  className="rounded-md border border-white/10 bg-void-900/60 px-2 py-1 text-sm text-slate-300 outline-none focus:border-arcane-500"
                />
                <button
                  onClick={() => removeTrait(charId, t.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-rose-500/15 hover:text-rose-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {customTraits.map((t) => (
              <div key={t.id} className="rounded-lg bg-void-900/40 px-3 py-2">
                <p className="font-medium text-slate-200">{t.name}</p>
                <p className="mt-1 text-sm text-slate-400">{t.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
