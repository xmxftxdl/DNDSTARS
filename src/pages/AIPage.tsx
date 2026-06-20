import { useMemo, useState } from 'react'
import { Bot, BrainCircuit, Cpu, Play, ShieldQuestion } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useCharacterStore } from '../store/characters'
import { useMapStore } from '../store/maps'
import {
  DEFAULT_DODGE_POLICY,
  runMapBattleSimulationDetailed,
  trainMapDodgePolicy,
  type MapSimulationActor,
  type MapSimulationDetailedResult,
  type SimulationSummary,
} from '../lib/aiPolicy'
import { characterToCombatInput, computeAc, computePhysicalAttack, DEFAULT_ENEMY_AC } from '../lib/combatStats'
import { getEnemyAc, getEnemyMaxHp, enemyCombatInput } from '../lib/enemyCombatStats'
import { getEnemyStatBlock } from '../lib/enemyStatBlocks'
import { abilityMod, proficiencyBonus } from '../lib/dnd'
import { DND_FEET_PER_CELL, pixelToCell } from '../lib/gridCombat'

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function fixed(value: number): string {
  return value.toFixed(2)
}

function SummaryCard({ title, summary }: { title: string; summary: SimulationSummary }) {
  const rows = [
    ['玩家胜率', percent(summary.playerWinRate)],
    ['敌人胜率', percent(summary.enemyWinRate)],
    ['平局/超时', percent(summary.drawRate)],
    ['平均回合', fixed(summary.averageRounds)],
    ['敌人平均闪避', fixed(summary.averageEnemyDodges)],
    ['闪避成功次数', fixed(summary.averageEnemyDodgeSuccesses)],
    ['玩家剩余 HP', fixed(summary.averagePlayerHpRemaining)],
    ['敌人剩余 HP', fixed(summary.averageEnemyHpRemaining)],
  ]
  return (
    <section className="glass rounded-2xl p-5">
      <h3 className="text-base font-semibold text-slate-100">{title}</h3>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-void-900/50 p-3">
            <div className="text-xs text-slate-500">{label}</div>
            <div className="mt-1 text-lg font-bold text-slate-100">{value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function SimulationRunsPanel({ title, result }: { title: string; result: MapSimulationDetailedResult }) {
  const [filter, setFilter] = useState<'all' | 'player' | 'enemy' | 'draw'>('all')
  const visibleRuns = result.runs.filter((run) => filter === 'all' || run.outcome === filter)
  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">共 {result.runs.length} 次模拟；点击单场可展开完整 log。</p>
        </div>
        <div className="flex rounded-xl border border-white/10 bg-void-900/60 p-1 text-xs">
          {[
            ['all', '全部'],
            ['player', '玩家胜'],
            ['enemy', '敌人胜'],
            ['draw', '平局'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key as 'all' | 'player' | 'enemy' | 'draw')}
              className={[
                'rounded-lg px-2.5 py-1 font-medium transition-colors',
                filter === key ? 'bg-arcane-500/25 text-arcane-100' : 'text-slate-400 hover:text-slate-200',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 max-h-[34rem] space-y-2 overflow-y-auto pr-1">
        {visibleRuns.map((run) => (
          <details key={run.index} className="rounded-xl border border-white/10 bg-void-900/55 px-3 py-2">
            <summary className="cursor-pointer list-none text-sm text-slate-200">
              <span className="font-semibold">#{run.index}</span>
              <span className="ml-3">
                {run.outcome === 'player' ? '玩家胜利' : run.outcome === 'enemy' ? '敌人胜利' : '平局/超时'}
              </span>
              <span className="ml-3 text-xs text-slate-500">
                {run.rounds} 回合 / 玩家HP {run.playerHpRemaining} / 敌人HP {run.enemyHpRemaining} / 敌闪避 {run.enemyDodges}
              </span>
            </summary>
            <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs leading-5 text-slate-300">
              {run.log.join('\n')}
            </pre>
          </details>
        ))}
      </div>
    </section>
  )
}

export default function AIPage() {
  const [runs, setRuns] = useState(1000)
  const [baseline, setBaseline] = useState<MapSimulationDetailedResult | null>(null)
  const [trained, setTrained] = useState<ReturnType<typeof trainMapDodgePolicy> | null>(null)
  const [trainedDetail, setTrainedDetail] = useState<MapSimulationDetailedResult | null>(null)
  const [busy, setBusy] = useState(false)
  const maps = useMapStore((s) => s.maps)
  const selectedMapId = useMapStore((s) => s.selectedId)
  const characters = useCharacterStore((s) => s.characters)
  const activeMap = maps.find((map) => map.id === selectedMapId) ?? maps[0] ?? null

  const encounterActors = useMemo<MapSimulationActor[]>(() => {
    if (!activeMap) return []
    return activeMap.tokens
      .filter((token) => token.type === 'player' || token.type === 'enemy')
      .map((token): MapSimulationActor | null => {
        const cell = pixelToCell(token.x, token.y, activeMap)
        if (token.type === 'player') {
          const character = token.characterId ? characters.find((c) => c.id === token.characterId) : undefined
          if (!character) return null
          const input = characterToCombatInput(character)
          const basicShot = character.combatSkills.find((skill) => skill.skillTreeId === 'basicShot')
          return {
            id: token.id,
            label: character.name || token.label,
            team: 'player',
            x: cell.col,
            y: cell.row,
            hp: Math.max(0, character.currentHp),
            maxHp: Math.max(1, character.maxHp),
            ac: computeAc(input),
            attackBonus: abilityMod(character.abilities.dex) + proficiencyBonus(character.level),
            damageDice: {
              count: Math.max(1, basicShot?.damageCount ?? 1),
              sides: Math.max(4, basicShot?.damageSides ?? 8),
              bonus: Math.max(0, basicShot?.damageBonus ?? 0),
            },
            speedCells: Math.max(1, Math.floor((character.speed || 30) / DND_FEET_PER_CELL)),
            attackRangeCells: 18,
          }
        }
        const block = token.poolId ? getEnemyStatBlock(token.poolId) : undefined
        const input = token.poolId ? enemyCombatInput(token.poolId) : undefined
        const attackScore = block ? Math.max(abilityMod(block.abilities.str), abilityMod(block.abilities.dex)) : 2
        const physicalAttack = input ? computePhysicalAttack(input) : 40
        const speedFeet = Number((block?.speed ?? '30').match(/\d+/)?.[0] ?? 30)
        return {
          id: token.id,
          label: token.label,
          team: 'enemy',
          x: cell.col,
          y: cell.row,
          hp: Math.max(0, token.hp ?? (token.poolId ? getEnemyMaxHp(token.poolId) : 12)),
          maxHp: Math.max(1, token.maxHp ?? token.hp ?? (token.poolId ? getEnemyMaxHp(token.poolId) : 12)),
          ac: token.poolId ? getEnemyAc(token.poolId) : DEFAULT_ENEMY_AC,
          attackBonus: attackScore + 2,
          damageDice: { count: 1, sides: 6, bonus: Math.max(1, Math.round(physicalAttack / 20)) },
          speedCells: Math.max(1, Math.floor(speedFeet / DND_FEET_PER_CELL)),
          attackRangeCells: 1,
        }
      })
      .filter((actor): actor is MapSimulationActor => !!actor && actor.hp > 0)
  }, [activeMap, characters])

  const configText = useMemo(() => {
    const policy = trained?.policy ?? DEFAULT_DODGE_POLICY
    return [
      `最低闪避成功率：${percent(policy.minSuccessChance)}`,
      `显著伤害阈值：${percent(policy.significantDamageRatio)}`,
      `致命伤害最低成功率：${percent(policy.lethalSuccessChance)}`,
    ].join(' / ')
  }, [trained])

  const runBaseline = () => {
    if (encounterActors.length === 0) return
    setBusy(true)
    window.setTimeout(() => {
      setBaseline(
        runMapBattleSimulationDetailed({
          runs,
          roundsLimit: 20,
          policy: DEFAULT_DODGE_POLICY,
          seed: 20260615,
          actors: encounterActors,
        }),
      )
      setBusy(false)
    }, 0)
  }

  const runTraining = () => {
    if (encounterActors.length === 0) return
    setBusy(true)
    window.setTimeout(() => {
      const trainedResult = trainMapDodgePolicy(encounterActors, runs)
      setTrained(trainedResult)
      setTrainedDetail(
        runMapBattleSimulationDetailed({
          runs,
          roundsLimit: 20,
          policy: trainedResult.policy,
          seed: 303030,
          actors: encounterActors,
        }),
      )
      setBusy(false)
    }, 0)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        title="AI 训练与平衡测试"
        description="读取当前地图上的角色和怪物，批量模拟真实遭遇，并检查敌人闪避策略是否拖慢战斗。"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <label className="glass flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-300">
              模拟次数
              <input
                type="number"
                min={100}
                max={20000}
                step={100}
                value={runs}
                onChange={(e) => setRuns(Math.max(100, Number(e.target.value) || 1000))}
                className="w-24 rounded-lg border border-white/10 bg-void-900 px-2 py-1 text-right text-slate-100 outline-none focus:border-arcane-500"
              />
            </label>
            <button
              onClick={runBaseline}
              disabled={busy || encounterActors.length === 0}
              className="glass flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-arcane-400/60 hover:text-white disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              跑默认策略
            </button>
            <button
              onClick={runTraining}
              disabled={busy || encounterActors.length === 0}
              className="glow-arcane flex items-center gap-2 rounded-xl bg-gradient-to-br from-arcane-500 to-arcane-600 px-4 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02] disabled:opacity-50"
            >
              <BrainCircuit className="h-4 w-4" />
              本地训练
            </button>
          </div>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        <div className="glass rounded-2xl p-5">
          <ShieldQuestion className="h-6 w-6 text-sky-300" />
          <h3 className="mt-3 font-semibold text-slate-100">闪避不再无脑触发</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">敌人会根据成功率、预估伤害和致命风险决定是否花费 AP。</p>
        </div>
        <div className="glass rounded-2xl p-5">
          <Cpu className="h-6 w-6 text-emerald-300" />
          <h3 className="mt-3 font-semibold text-slate-100">逐场记录</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">每次模拟都会保存逐回合 log，可以展开查看行动、闪避、命中和伤害。</p>
        </div>
        <div className="glass rounded-2xl p-5">
          <Bot className="h-6 w-6 text-violet-300" />
          <h3 className="mt-3 font-semibold text-slate-100">当前地图遭遇</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">模拟使用当前选中地图的 token 坐标、绑定角色卡和怪物模板。</p>
        </div>
      </section>

      <section className="glass rounded-2xl p-5">
        <h3 className="text-base font-semibold text-slate-100">当前推荐策略</h3>
        <p className="mt-2 text-sm text-slate-400">{configText}</p>
        {trained && (
          <p className="mt-2 text-xs text-slate-500">
            训练评分 {trained.score.toFixed(4)}，目标是让玩家胜率靠近 60%，同时惩罚过多闪避和拖回合。
          </p>
        )}
      </section>

      <section className="glass rounded-2xl p-5">
        <h3 className="text-base font-semibold text-slate-100">当前地图遭遇</h3>
        <p className="mt-2 text-sm text-slate-400">
          {activeMap ? `地图：${activeMap.name}，读取 ${encounterActors.length} 个存活战斗单位。` : '还没有选中地图。'}
        </p>
        {encounterActors.length > 0 ? (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {encounterActors.map((actor) => (
              <div key={actor.id} className="rounded-xl border border-white/10 bg-void-900/50 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className={actor.team === 'player' ? 'font-semibold text-emerald-200' : 'font-semibold text-rose-200'}>
                    {actor.label}
                  </span>
                  <span className="text-xs text-slate-500">({actor.x},{actor.y})</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  HP {actor.hp}/{actor.maxHp} / AC {actor.ac} / 命中 +{actor.attackBonus} / 伤害 {actor.damageDice.count}D{actor.damageDice.sides}+{actor.damageDice.bonus}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-amber-300">当前地图没有可模拟的玩家和敌人 token，或玩家 token 未绑定角色卡。</p>
        )}
      </section>

      <div className="space-y-4">
        {baseline && <SummaryCard title="默认策略模拟结果" summary={baseline.summary} />}
        {baseline && <SimulationRunsPanel title="默认策略模拟明细" result={baseline} />}
        {trainedDetail && <SummaryCard title="训练后策略模拟结果" summary={trainedDetail.summary} />}
        {trainedDetail && <SimulationRunsPanel title="训练后策略模拟明细" result={trainedDetail} />}
      </div>
    </div>
  )
}
