import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { defaultTokenSizeForMap, realignTokensToGrid, snapToCellCenter } from '../lib/gridCombat'
import { applyGridDetectPatch, type GridDetectResult } from '../lib/gridDetect'
import { enemyTemplateToTokenPatch, type EnemyTemplate } from '../lib/enemyPool'
import { putImage, deleteImage } from '../lib/imageStore'
import { loadSharedResource, saveSharedResource } from '../lib/sharedApi'
import { canWriteSharedState, isPlayerPort } from '../lib/appMode'
function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

let lastSharedMapsSnapshot = ''
let lastSharedMapsUpdatedAt = 0

interface SharedMapsState {
  maps: BattleMap[]
  selectedId: string | null
  updatedAt?: number
}

function mergePlayerTokenCombatFields(localMaps: BattleMap[], sharedMaps: BattleMap[]): BattleMap[] {
  const sharedMapById = new Map(sharedMaps.map((map) => [map.id, map]))
  return localMaps.map((map) => {
    const sharedMap = sharedMapById.get(map.id)
    if (!sharedMap) return map
    const sharedTokenById = new Map(sharedMap.tokens.map((token) => [token.id, token]))
    return {
      ...map,
      tokens: map.tokens.map((token) => {
        const sharedToken = sharedTokenById.get(token.id)
        if (!sharedToken) return token
        const dmControlledPosition =
          token.type !== 'player'
            ? {
                x: sharedToken.x,
                y: sharedToken.y,
              }
            : {}
        return {
          ...token,
          ...dmControlledPosition,
          hp: sharedToken.hp,
          maxHp: sharedToken.maxHp,
          burningTurns: sharedToken.burningTurns,
          igniteTurns: sharedToken.igniteTurns,
          poisonTurns: sharedToken.poisonTurns,
          knockbackTurns: sharedToken.knockbackTurns,
          stunTurns: sharedToken.stunTurns,
          restrainedTurns: sharedToken.restrainedTurns,
          vulnerableTurns: sharedToken.vulnerableTurns,
          noMoveTurns: sharedToken.noMoveTurns,
          huntingMarkStacks: sharedToken.huntingMarkStacks,
        }
      }),
    }
  })
}

function publishMapsState(state: Pick<MapState, 'maps' | 'selectedId'>): void {
  void (async () => {
    let maps = state.maps
    if (isPlayerPort()) {
      const shared = await loadSharedResource<SharedMapsState>('maps')
      if (shared?.maps) maps = mergePlayerTokenCombatFields(maps, shared.maps)
    }
    const payload: SharedMapsState = { maps, selectedId: state.selectedId, updatedAt: Date.now() }
    lastSharedMapsUpdatedAt = payload.updatedAt ?? Date.now()
    lastSharedMapsSnapshot = JSON.stringify(payload)
    await saveSharedResource('maps', payload)
  })()
}

export interface Token {
  id: string
  label: string
  x: number // 画布坐标（图片像素）
  y: number
  color: string // 边框/底色
  emoji: string
  size: number // 直径（格数的倍数，1 = 一格）
  type: 'player' | 'enemy' | 'npc' | 'obstacle'
  characterId?: string // 关联的角色（点击 token 即可调出其技能栏）
  hp?: number // 生命值（用于未关联角色的敌人/NPC）
  maxHp?: number
  /** 玩家端是否在 Token 上方显示血量条（DM 始终显示；默认对玩家可见） */
  showHpOnToken?: boolean
  /** 玩家端点击时是否显示怪物详情（DM 始终显示；默认对玩家可见） */
  showDetailOnToken?: boolean
  /** 燃烧剩余回合，0 或未设置 = 未燃烧 */
  burningTurns?: number
  /** 点燃剩余回合，0 或未设置 = 未点燃 */
  igniteTurns?: number
  /** 中毒剩余回合，0 或未设置 = 未中毒 */
  poisonTurns?: number
  /** 击飞剩余回合，0 或未设置 = 未被击飞 */
  knockbackTurns?: number
  /** 眩晕剩余回合，0 或未设置 = 未眩晕 */
  stunTurns?: number
  /** 束缚剩余回合，0 或未设置 = 未束缚 */
  restrainedTurns?: number
  /** 脆弱剩余回合，0 或未设置 = 未脆弱 */
  vulnerableTurns?: number
  /** 禁止移动剩余回合，0 或未设置 = 可移动 */
  noMoveTurns?: number
  /** 逐风者 · 狩猎印记层数（0–4） */
  huntingMarkStacks?: number
  /** 来自怪物池的模板 id */
  poolId?: string
  obstacleKind?: string
}

export interface BattleMap {
  id: string
  name: string
  width: number
  height: number
  gridSize: number // 每格像素（1 格 = 5 尺）
  gridOffsetX: number
  gridOffsetY: number
  showGrid: boolean
  /** 上传时识别到底图自带网格 */
  builtinGridDetected?: boolean
  feetPerCell?: number
  /** 叠加网格颜色 #RRGGBB */
  gridColor?: string
  /** 叠加网格不透明度 0–1 */
  gridOpacity?: number
  /** 显示地图格子的 X/Y 坐标轴 */
  showCoordinates?: boolean
  /** 勾选后敌人/NPC 拖放时吸附到格心 */
  snapMonstersToGrid?: boolean
  tokens: Token[]
}

/**
 * [T10/AC3 · E10] maps 持久化版本号。characters store 早已带 version+migrate（version 19），
 * 而 maps store 此前裸跑 `{ name:'stars-maps' }`，没有版本/迁移：任何旧 localStorage 形状
 * 一旦缺字段（如早期 token 没有 type、map 没有 tokens 数组）就可能在渲染期炸掉。
 * 这里补齐 version + migrate，把任意旧/残缺形状规整为当前 BattleMap 形状。
 */
export const MAPS_PERSIST_VERSION = 1

const TOKEN_TYPES: ReadonlyArray<Token['type']> = ['player', 'enemy', 'npc', 'obstacle']

/** 把任意（可能是旧版本、可能残缺）的 token 形状规整为当前 Token 形状。 */
function normalizeToken(raw: unknown): Token {
  const t = (raw ?? {}) as Partial<Token>
  const type = TOKEN_TYPES.includes(t.type as Token['type']) ? (t.type as Token['type']) : 'enemy'
  const preset = TOKEN_PRESETS[type]
  return {
    ...t,
    id: typeof t.id === 'string' && t.id ? t.id : uid(),
    label: typeof t.label === 'string' ? t.label : '',
    x: Number.isFinite(t.x) ? (t.x as number) : 0,
    y: Number.isFinite(t.y) ? (t.y as number) : 0,
    color: typeof t.color === 'string' && t.color ? t.color : preset.color,
    emoji: typeof t.emoji === 'string' && t.emoji ? t.emoji : preset.emoji,
    size: Number.isFinite(t.size) && (t.size as number) > 0 ? (t.size as number) : 1,
    type,
  }
}

/** 把任意旧形状的单张地图规整为当前 BattleMap 形状（缺字段填默认，tokens 逐个规整）。 */
function normalizeMap(raw: unknown): BattleMap {
  const m = (raw ?? {}) as Partial<BattleMap>
  const tokens = Array.isArray(m.tokens) ? m.tokens.map(normalizeToken) : []
  return {
    ...m,
    id: typeof m.id === 'string' && m.id ? m.id : uid(),
    name: typeof m.name === 'string' ? m.name : '未命名地图',
    width: Number.isFinite(m.width) ? (m.width as number) : 0,
    height: Number.isFinite(m.height) ? (m.height as number) : 0,
    gridSize: Number.isFinite(m.gridSize) && (m.gridSize as number) > 0 ? (m.gridSize as number) : 70,
    gridOffsetX: Number.isFinite(m.gridOffsetX) ? (m.gridOffsetX as number) : 0,
    gridOffsetY: Number.isFinite(m.gridOffsetY) ? (m.gridOffsetY as number) : 0,
    showGrid: typeof m.showGrid === 'boolean' ? m.showGrid : true,
    tokens,
  }
}

interface PersistedMapState {
  maps?: unknown
  selectedId?: unknown
}

/**
 * [T10/AC3] 纯函数：把任意持久化快照（含 version 0 = 无版本的旧形状）迁移到当前形状。
 * 单独导出以便 T13 在不挂载组件、不碰 localStorage 的前提下单测。
 * 任何旧 `stars-maps` blob 都应被这里规整为可直接渲染、不崩溃的当前 MapState。
 */
export function migrateMapsState(persisted: unknown): Pick<MapState, 'maps' | 'selectedId'> {
  const p = (persisted ?? {}) as PersistedMapState
  const maps = Array.isArray(p.maps) ? p.maps.map(normalizeMap) : []
  const selectedId =
    typeof p.selectedId === 'string' && maps.some((m) => m.id === p.selectedId)
      ? (p.selectedId as string)
      : (maps[0]?.id ?? null)
  return { maps, selectedId }
}

/**
 * [T10/AC1 · E4] 角色 → token.hp 单向镜像的唯一真相源。
 * `Character.currentHp` 是关联 token 血量的权威；token.hp 只是它的镜像（玩家端合并/阵亡判定用）。
 * 所有改血路径（普通伤害 / DOT 每回合 / 静水回血 / 魔法浪涌）改完 character 后，
 * 都用本 helper 算出要写回 token 的 patch，保证 `token.hp === character.currentHp`、不被任何路径绕过。
 * 纯函数，便于单测：post-change 断言 patch.hp === character.currentHp。
 */
export function characterHpTokenPatch(char: {
  currentHp: number
  maxHp: number
}): Pick<Token, 'hp' | 'maxHp'> {
  return { hp: char.currentHp, maxHp: char.maxHp }
}

const TOKEN_PRESETS = {
  player: { color: '#34d399', emoji: '🛡️' },
  enemy: { color: '#f87171', emoji: '👹' },
  npc: { color: '#fbbf24', emoji: '🧑' },
  obstacle: { color: '#94a3b8', emoji: '🪨' },
}

interface MapState {
  maps: BattleMap[]
  selectedId: string | null
  loadShared: () => Promise<void>
  select: (id: string | null) => void
  addMap: (meta: {
    name: string
    width: number
    height: number
    blob: Blob
    gridDetect?: GridDetectResult
  }) => Promise<string>
  updateMap: (id: string, patch: Partial<BattleMap>) => void
  removeMap: (id: string) => void
  addToken: (mapId: string, type: Token['type']) => void
  addObstacle: (mapId: string, kind: string) => void
  addEnemyFromPool: (mapId: string, template: EnemyTemplate) => string | null
  addCharacterToken: (
    mapId: string,
    payload: { characterId: string; name: string; emoji: string; type?: Token['type'] },
  ) => void
  updateToken: (mapId: string, tokenId: string, patch: Partial<Token>) => void
  removeToken: (mapId: string, tokenId: string) => void
}

export const useMapStore = create<MapState>()(
  persist(
    (set, get) => ({
      maps: [],
      selectedId: null,
      loadShared: async () => {
        const shared = await loadSharedResource<SharedMapsState>('maps')
        if (!shared?.maps) {
          if (canWriteSharedState()) publishMapsState(get())
          return
        }
        if (!isPlayerPort() && (shared.updatedAt ?? 0) < lastSharedMapsUpdatedAt) return
        lastSharedMapsUpdatedAt = shared.updatedAt ?? lastSharedMapsUpdatedAt
        const snapshot = JSON.stringify(shared)
        if (snapshot === lastSharedMapsSnapshot) return
        lastSharedMapsSnapshot = snapshot
        set({ maps: shared.maps, selectedId: shared.selectedId ?? shared.maps[0]?.id ?? null })
      },
      select: (id) => set({ selectedId: id }),

      addMap: async ({ name, width, height, blob, gridDetect }) => {
        const id = uid()
        await putImage(id, blob)
        const gridPatch = gridDetect ? applyGridDetectPatch(gridDetect) : { builtinGridDetected: false }
        const map: BattleMap = {
          id,
          name,
          width,
          height,
          gridSize: gridPatch.gridSize ?? 70,
          gridOffsetX: gridPatch.gridOffsetX ?? 0,
          gridOffsetY: gridPatch.gridOffsetY ?? 0,
          showGrid: gridPatch.showGrid ?? true,
          builtinGridDetected: gridPatch.builtinGridDetected,
          feetPerCell: 5,
          gridColor: '#c4b5fd',
          gridOpacity: 0.28,
          showCoordinates: true,
          snapMonstersToGrid: true,
          tokens: [],
        }
        set((s) => ({ maps: [...s.maps, map], selectedId: id }))
        publishMapsState(get())
        return id
      },

      updateMap: (id, patch) => {
        set((s) => ({
          maps: s.maps.map((m) => {
            if (m.id !== id) return m
            const next = { ...m, ...patch }
            const gridChanged =
              (patch.gridSize != null && patch.gridSize !== m.gridSize) ||
              (patch.gridOffsetX != null && patch.gridOffsetX !== m.gridOffsetX) ||
              (patch.gridOffsetY != null && patch.gridOffsetY !== m.gridOffsetY)
            if (gridChanged) {
              next.tokens = realignTokensToGrid(next.tokens, next)
            }
            return next
          }),
        }))
        publishMapsState(get())
      },

      removeMap: (id) => {
        void deleteImage(id)
        set((s) => {
          const maps = s.maps.filter((m) => m.id !== id)
          return { maps, selectedId: s.selectedId === id ? (maps[0]?.id ?? null) : s.selectedId }
        })
        publishMapsState(get())
      },

      addToken: (mapId, type) => {
        const map = get().maps.find((m) => m.id === mapId)
        if (!map) return
        const preset = TOKEN_PRESETS[type]
        const defaultHp = type === 'enemy' ? 20 : type === 'npc' ? 12 : undefined
        const spawn = snapToCellCenter(map.width / 2, map.height / 2, map)
        const tokenSize = defaultTokenSizeForMap(map)
        const token: Token = {
          id: uid(),
          label: type === 'player' ? '玩家' : type === 'enemy' ? '敌人' : 'NPC',
          x: spawn.x,
          y: spawn.y,
          color: preset.color,
          emoji: preset.emoji,
          size: tokenSize,
          type,
          hp: defaultHp,
          maxHp: defaultHp,
        }
        set((s) => ({
          maps: s.maps.map((m) => (m.id === mapId ? { ...m, tokens: [...m.tokens, token] } : m)),
        }))
        publishMapsState(get())
      },

      addObstacle: (mapId, kind) => {
        const map = get().maps.find((m) => m.id === mapId)
        if (!map) return
        const templates: Record<string, { label: string; emoji: string; size: number; color: string }> = {
          rock: { label: '石头', emoji: '🪨', size: 1, color: '#94a3b8' },
          chair: { label: '椅子', emoji: '🪑', size: 1, color: '#a16207' },
          pillar: { label: '石柱', emoji: '🏛️', size: 1, color: '#cbd5e1' },
          table: { label: '翻倒的桌子', emoji: '▰', size: 2, color: '#92400e' },
        }
        const tpl = templates[kind] ?? templates.rock
        const spawn = snapToCellCenter(map.width / 2, map.height / 2, map)
        const token: Token = {
          id: uid(),
          label: tpl.label,
          x: spawn.x,
          y: spawn.y,
          color: tpl.color,
          emoji: tpl.emoji,
          size: tpl.size,
          type: 'obstacle',
          obstacleKind: kind,
          showHpOnToken: false,
          showDetailOnToken: false,
        }
        set((s) => ({
          maps: s.maps.map((m) => (m.id === mapId ? { ...m, tokens: [...m.tokens, token] } : m)),
        }))
        publishMapsState(get())
      },

      addEnemyFromPool: (mapId, template) => {
        const map = get().maps.find((m) => m.id === mapId)
        if (!map) return null
        const spawn = snapToCellCenter(map.width / 2, map.height / 2, map)
        const patch = enemyTemplateToTokenPatch(template)
        const token: Token = {
          id: uid(),
          label: patch.label ?? template.name,
          x: spawn.x,
          y: spawn.y,
          color: patch.color ?? '#f87171',
          emoji: patch.emoji ?? '👹',
          size: patch.size ?? defaultTokenSizeForMap(map),
          type: 'enemy',
          hp: patch.hp,
          maxHp: patch.maxHp,
          poolId: patch.poolId,
          showHpOnToken: patch.showHpOnToken ?? true,
          showDetailOnToken: patch.showDetailOnToken ?? true,
        }
        set((s) => ({
          maps: s.maps.map((m) => (m.id === mapId ? { ...m, tokens: [...m.tokens, token] } : m)),
        }))
        publishMapsState(get())
        return token.id
      },
      addCharacterToken: (mapId, { characterId, name, emoji, type = 'player' }) => {
        const map = get().maps.find((m) => m.id === mapId)
        if (!map) return
        const preset = TOKEN_PRESETS[type]
        const spawn = snapToCellCenter(map.width / 2, map.height / 2, map)
        const token: Token = {
          id: uid(),
          label: name,
          x: spawn.x,
          y: spawn.y,
          color: preset.color,
          emoji,
          size: defaultTokenSizeForMap(map),
          type,
          characterId,
        }
        set((s) => ({
          maps: s.maps.map((m) => (m.id === mapId ? { ...m, tokens: [...m.tokens, token] } : m)),
        }))
        publishMapsState(get())
      },

      updateToken: (mapId, tokenId, patch) => {
        set((s) => ({
          maps: s.maps.map((m) =>
            m.id === mapId
              ? { ...m, tokens: m.tokens.map((t) => (t.id === tokenId ? { ...t, ...patch } : t)) }
              : m,
          ),
        }))
        publishMapsState(get())
      },

      removeToken: (mapId, tokenId) => {
        set((s) => ({
          maps: s.maps.map((m) =>
            m.id === mapId ? { ...m, tokens: m.tokens.filter((t) => t.id !== tokenId) } : m,
          ),
        }))
        publishMapsState(get())
      },
    }),
    {
      name: 'stars-maps',
      version: MAPS_PERSIST_VERSION,
      // [T10/AC3 · E10] 旧形状（version 0 = 此前无版本）经此迁移到当前形状，避免渲染期崩溃。
      migrate: (persisted) => migrateMapsState(persisted) as MapState,
    },
  ),
)
