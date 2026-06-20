// [T11] 共享服务端硬化核心：原子写锁 / 鉴权 / size cap / backlog cap / 图片配额 /
// safeName 防碰撞 / API-404。两个服务端（vite-server.mjs + static-server.mjs）都从这里
// import 同一份纯逻辑，避免双份漂移；纯函数集中在此以便 src/ 下的 vitest 直接 import .mjs。
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

// ── AC3：PUT body 上限 + backlog 回放上限 ────────────────────────────────────
// 单次 PUT 请求体上限（8 MiB）。超过 → 413。图片走单独更宽的上限（见 IMAGE_MAX_BYTES）。
export const STATE_MAX_BYTES = 8 * 1024 * 1024
// 单张图片上限（24 MiB）。
export const IMAGE_MAX_BYTES = 24 * 1024 * 1024
// 事件 backlog 总容量（环形缓冲，保持与历史一致）。
export const EVENT_BACKLOG_LIMIT = 1200
// 新订阅者只回放最近 N 条，而不是把整 1200 条全量灌给它（AC3）。
export const EVENT_REPLAY_LIMIT = 100

// ── AC4：图片配额 ───────────────────────────────────────────────────────────
// 最多保留多少张共享图片（含 meta，不计 .json）。超过时按 mtime 最旧优先 GC。
export const IMAGE_COUNT_LIMIT = 64

// ── AC1：跨进程写锁（lockfile + 陈旧超时，崩溃不死锁）───────────────────────
// 锁陈旧超时：持锁进程崩溃后，锁最多被视为有效这么久；超过即判为陈旧可抢占。
export const LOCK_STALE_MS = 10_000
// 抢锁时单次重试间隔与总等待上限。
const LOCK_RETRY_MS = 20
const LOCK_WAIT_MAX_MS = 5_000

// 进程内串行化：同一文件路径的写在本进程内排队（关闭进程内交错）。
const inProcessLockChain = new Map()

async function isLockStale(lockPath) {
  try {
    const info = await stat(lockPath)
    return Date.now() - info.mtimeMs > LOCK_STALE_MS
  } catch {
    // 锁文件已不存在 → 不算陈旧（让抢占循环重试创建）。
    return false
  }
}

// 跨进程：用 wx（O_EXCL）独占创建 lockfile 作为锁。Windows 与 POSIX 都支持 wx 的
// 原子「不存在才创建」语义，因此是可移植做法（不依赖 fcntl/flock 这类平台相关的字节锁）。
// 崩溃安全：锁文件带 mtime，超过 LOCK_STALE_MS 即被判陈旧并强制移除后重抢，绝不永久死锁。
async function acquireCrossProcessLock(lockPath, pid) {
  const deadline = Date.now() + LOCK_WAIT_MAX_MS
  for (;;) {
    try {
      await writeFile(lockPath, String(pid ?? process.pid), { flag: 'wx' })
      return
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      if (await isLockStale(lockPath)) {
        // 陈旧锁（持锁者多半已崩溃）→ 移除后重抢。
        await rm(lockPath, { force: true })
        continue
      }
      if (Date.now() > deadline) {
        // 等待超时：宁可放行（避免请求永久挂起），进程内链 + 原子 rename 仍是兜底。
        return
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
    }
  }
}

/**
 * 串行化对同一资源文件的写：进程内 promise 链 + 跨进程 lockfile，二者叠加。
 * fn 在两层锁都到手后执行；无论 fn 成败都释放锁（finally），不会因抛错而泄漏锁。
 */
export async function withWriteLock(filePath, fn) {
  const lockPath = `${filePath}.lock`
  const prev = inProcessLockChain.get(filePath) ?? Promise.resolve()
  let release
  const current = new Promise((resolve) => {
    release = resolve
  })
  const chained = prev.then(() => current)
  inProcessLockChain.set(filePath, chained)
  await prev.catch(() => {})
  try {
    await acquireCrossProcessLock(lockPath)
    try {
      return await fn()
    } finally {
      await rm(lockPath, { force: true }).catch(() => {})
    }
  } finally {
    release()
    // 链尾消费完后清理 map，防止条目无限堆积。
    if (inProcessLockChain.get(filePath) === chained) inProcessLockChain.delete(filePath)
  }
}

/**
 * 原子写：临时文件 + rename，外裹 withWriteLock。保留既有 temp+rename 语义不变。
 */
export async function atomicWriteLocked(filePath, body) {
  await withWriteLock(filePath, async () => {
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(tmpPath, body)
    await rename(tmpPath, filePath)
  })
}

// ── AC5：safeName 防碰撞 ────────────────────────────────────────────────────
// 旧实现把所有非 [a-zA-Z0-9_-] 直接删掉，会把 "a/b" 与 "ab"、"x.1" 与 "x1" 折叠成同一文件。
// 现在：保留白名单字符原样，对任何含被删字符的输入追加一段确定性 hash 后缀，使不同逻辑名
// 必映射到不同文件名（碰撞概率可忽略），同时输出仍只含文件系统安全字符。
export function safeName(value) {
  const raw = String(value ?? '')
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '')
  if (cleaned === raw && raw.length > 0) return raw
  // 含需要编码的字符（或为空）→ 追加 FNV-1a hash 后缀去碰撞。
  const hash = fnv1a(raw).toString(36)
  return `${cleaned}-${hash}`
}

function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// ── AC2：鉴权（默认关闭，opt-in）────────────────────────────────────────────
// 服务端镜像 sharedApi.ts 的「玩家可写白名单」。flag 开启时，仅 DM 权威资源（不在白名单内，
// 主要是 combat / player-action-ack）才要求 secret；白名单资源玩家照常可写。
export const PLAYER_WRITABLE_STATE = new Set([
  'characters',
  'maps',
  'dodge',
  'stable-mind',
  'player-action',
  'dice',
  'dice-events',
  'combat-log',
])

export function sharedSecret() {
  const value = process.env.STARS_SHARED_SECRET
  return value && value.length > 0 ? value : null
}

export function authEnabled() {
  return sharedSecret() != null
}

/**
 * 写鉴权判定。返回 { ok:true } 或 { ok:false, status }.
 * - flag 未设（secret==null）⇒ 永远放行（与今日行为字节等价，零回归）。
 * - flag 设了 + 资源在玩家白名单 ⇒ 放行（玩家照常写 characters/maps/...）。
 * - flag 设了 + DM 权威资源 + secret 正确 ⇒ 放行。
 * - flag 设了 + DM 权威资源 + secret 缺失/错误 ⇒ 401/403。
 */
export function authorizeStateWrite(resourceName, providedSecret) {
  const secret = sharedSecret()
  if (secret == null) return { ok: true }
  if (PLAYER_WRITABLE_STATE.has(resourceName)) return { ok: true }
  if (providedSecret == null || providedSecret === '') return { ok: false, status: 401 }
  if (providedSecret !== secret) return { ok: false, status: 403 }
  return { ok: true }
}

// ── AC4：图片配额 GC ────────────────────────────────────────────────────────
/**
 * 图片配额触发器（DOCUMENTED）：每次 PUT 写入新图片成功后触发一次 GC（write-trigger）。
 * 列出 imageRoot 下所有非 .json 主文件，按 mtime 升序，删除超过 IMAGE_COUNT_LIMIT 的最旧者
 * （连带其 .json meta）。这把「写时增长」即时收口，无需后台定时器，也不依赖客户端 load。
 */
export async function enforceImageQuota(imageRoot) {
  let entries
  try {
    entries = await readdir(imageRoot)
  } catch {
    return []
  }
  const mains = entries.filter((name) => !name.endsWith('.json'))
  if (mains.length <= IMAGE_COUNT_LIMIT) return []
  const withMtime = []
  for (const name of mains) {
    try {
      const info = await stat(path.join(imageRoot, name))
      withMtime.push({ name, mtime: info.mtimeMs })
    } catch {
      // 文件并发消失，跳过。
    }
  }
  withMtime.sort((a, b) => a.mtime - b.mtime)
  const removeCount = withMtime.length - IMAGE_COUNT_LIMIT
  const removed = []
  for (let i = 0; i < removeCount; i += 1) {
    const { name } = withMtime[i]
    await rm(path.join(imageRoot, name), { force: true }).catch(() => {})
    await rm(path.join(imageRoot, `${name}.json`), { force: true }).catch(() => {})
    removed.push(name)
  }
  return removed
}

// ── AC3：backlog 回放上限 ───────────────────────────────────────────────────
/** 新订阅者只取 backlog 末尾 EVENT_REPLAY_LIMIT 条。 */
export function replaySlice(backlog) {
  if (!Array.isArray(backlog)) return []
  if (backlog.length <= EVENT_REPLAY_LIMIT) return backlog
  return backlog.slice(backlog.length - EVENT_REPLAY_LIMIT)
}

/** 环形 backlog 追加，保持总量 ≤ EVENT_BACKLOG_LIMIT。 */
export function pushBacklog(backlog, payload) {
  backlog.push(payload)
  if (backlog.length > EVENT_BACKLOG_LIMIT) backlog.splice(0, backlog.length - EVENT_BACKLOG_LIMIT)
  return backlog
}

// ── 从请求头读取 secret（鉴权用）────────────────────────────────────────────
export function extractSecret(req) {
  const header = req?.headers?.['x-stars-secret']
  if (typeof header === 'string' && header.length > 0) return header
  return null
}

export { mkdir, readFile, rm, stat }
