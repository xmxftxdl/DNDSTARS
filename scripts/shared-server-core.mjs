// [T11] 共享服务端硬化核心：原子写锁 / 鉴权 / size cap / backlog cap / 图片配额 /
// safeName 防碰撞 / API-404。两个服务端（vite-server.mjs + static-server.mjs）都从这里
// import 同一份纯逻辑，避免双份漂移；纯函数集中在此以便 src/ 下的 vitest 直接 import .mjs。
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
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
// 这些时长运行时从 env 读取（默认值不变），便于测试用更短的超时触发 fail-closed 分支。
const LOCK_RETRY_MS = 20
function lockTimings() {
  return {
    staleMs: Number(process.env.STARS_LOCK_STALE_MS) || 10_000,
    waitMaxMs: Number(process.env.STARS_LOCK_WAIT_MAX_MS) || 5_000,
    // 持锁期间心跳刷新 mtime 的间隔，须显著小于 staleMs，否则慢写仍会被误判陈旧。
    heartbeatMs: Number(process.env.STARS_LOCK_HEARTBEAT_MS) || 3_000,
  }
}

// [T-P1-419/AC1] 抢锁超时的哨兵错误：withWriteLock 抛它 ⇒ 写 fail-closed，调用方映射 503/重试，
// 绝不在未持锁的情况下继续执行 fn()（旧实现超时即 return，放任两个进程同时进入 read-compare-rename）。
export class LockTimeoutError extends Error {
  constructor(lockPath) {
    super(`write lock acquire timed out: ${lockPath}`)
    this.name = 'LockTimeoutError'
    this.code = 'ELOCKTIMEOUT'
    this.statusCode = 503
  }
}

// 进程内串行化：同一文件路径的写在本进程内排队（关闭进程内交错）。
const inProcessLockChain = new Map()

async function isLockStale(lockPath) {
  try {
    const info = await stat(lockPath)
    return Date.now() - info.mtimeMs > lockTimings().staleMs
  } catch {
    // 锁文件已不存在 → 不算陈旧（让抢占循环重试创建）。
    return false
  }
}

// 跨进程：用 wx（O_EXCL）独占创建 lockfile 作为锁。Windows 与 POSIX 都支持 wx 的
// 原子「不存在才创建」语义，因此是可移植做法（不依赖 fcntl/flock 这类平台相关的字节锁）。
// 崩溃安全：锁文件带 mtime，超过 staleMs 即被判陈旧并强制移除后重抢，绝不永久死锁。
async function acquireCrossProcessLock(lockPath, pid) {
  const { waitMaxMs } = lockTimings()
  const deadline = Date.now() + waitMaxMs
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
        // [T-P1-419/AC1] 等待超时 ⇒ fail-closed：抛哨兵错误，绝不放行 fn() 无锁运行。
        throw new LockTimeoutError(lockPath)
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
    }
  }
}

// [T-P1-419/AC2] 持锁期间周期性 touch lockfile 的 mtime，使「合法持锁的慢写」不会因 mtime 老化
// 被第二个进程当作陈旧锁抢占；进程崩溃后心跳停止，staleMs 后才被回收（保留崩溃兜底）。
function startLockHeartbeat(lockPath) {
  const { heartbeatMs } = lockTimings()
  const timer = setInterval(() => {
    const now = new Date()
    void utimes(lockPath, now, now).catch(() => {})
  }, heartbeatMs)
  if (typeof timer.unref === 'function') timer.unref()
  return () => clearInterval(timer)
}

/**
 * 串行化对同一资源文件的写：进程内 promise 链 + 跨进程 lockfile，二者叠加。
 * fn 在两层锁都到手后执行；无论 fn 成败都释放锁（finally），不会因抛错而泄漏锁。
 * 抢锁超时 ⇒ 抛 LockTimeoutError（fail-closed），fn 不会运行。
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
    // 抢锁超时会从这里抛出 ⇒ 跳过下面的 try，绝不运行 fn()，也不会误删他人持有的锁。
    await acquireCrossProcessLock(lockPath)
    const stopHeartbeat = startLockHeartbeat(lockPath)
    try {
      return await fn()
    } finally {
      stopHeartbeat()
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

function updatedAtFromJsonBody(body) {
  try {
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body)
    const parsed = JSON.parse(text)
    const value = Number(parsed?.updatedAt)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

export async function atomicWriteJsonStateFreshLocked(filePath, body) {
  return withWriteLock(filePath, async () => {
    const incomingUpdatedAt = updatedAtFromJsonBody(body)
    if (incomingUpdatedAt != null) {
      try {
        const existing = await readFile(filePath, 'utf8')
        const existingUpdatedAt = updatedAtFromJsonBody(existing)
        if (existingUpdatedAt != null && incomingUpdatedAt < existingUpdatedAt) {
          return false
        }
      } catch {
        // No existing state yet; accept the write.
      }
    }
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(tmpPath, body)
    await rename(tmpPath, filePath)
    return true
  })
}

// [T-P1-419/AC3·AC4] 图片 PUT 走与 state 同一把锁 + temp+rename：blob 与 meta 在同一把锁内各自
// 原子落盘，使 GET 永远看不到半写的 blob 或 blob/meta 不匹配；两个并发 PUT 在 imagePath 锁上串行，
// 胜者的 blob 与 meta 必来自同一次 PUT（不交叉配对）。图片按 id 寻址，无 freshness 比较。
async function atomicRename(filePath, body) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(tmpPath, body)
  await rename(tmpPath, filePath)
}

export async function atomicWriteImageLocked(imagePath, metaPath, blob, metaBody) {
  return withWriteLock(imagePath, async () => {
    await atomicRename(imagePath, blob)
    await atomicRename(metaPath, metaBody)
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
const PLAYER_WRITABLE_STATE = new Set([
  'characters',
  'maps',
  'dodge',
  'gale-combo',
  'stable-mind',
  'player-action',
  'player-action-requests',
  'dice',
  'dice-events',
  'combat-log',
])

function sharedSecret() {
  const value = process.env.STARS_SHARED_SECRET
  return value && value.length > 0 ? value : null
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

// ── AC5：/api 分发的单一实现 ────────────────────────────────────────────────
// 两个服务端（vite-server.mjs + static-server.mjs）此前各自复制了一份字节相同的 /api 分发逻辑
// （events / state / image），极易漂移。现集中到此处单一定义，服务端只保留各自的静态回退差异。
// ctx = { stateRoot, imageRoot, legacyStateRoot, legacyImageRoot, eventClients, eventBacklog }
function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

// 限制请求体大小，超过 maxBytes 即抛 413 标记错误。超限后继续 drain 剩余分块再抛，
// 避免 req.destroy() 触发 ECONNRESET 让客户端拿不到干净 413。
async function readBody(req, maxBytes = STATE_MAX_BYTES) {
  const chunks = []
  let total = 0
  let over = false
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) {
      over = true
      continue
    }
    if (!over) chunks.push(chunk)
  }
  if (over) {
    const err = new Error('Payload Too Large')
    err.statusCode = 413
    throw err
  }
  return Buffer.concat(chunks)
}

function addEventClient(ctx, channel, res) {
  const clients = ctx.eventClients.get(channel) ?? new Set()
  clients.add(res)
  ctx.eventClients.set(channel, clients)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })
  res.write(`event: ready\ndata: {"channel":"${channel}"}\n\n`)
  // 只回放最近 EVENT_REPLAY_LIMIT 条，而非整 backlog。
  const backlog = replaySlice(ctx.eventBacklog.get(channel) ?? [])
  for (const payload of backlog) {
    res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)
  }
  return () => {
    clients.delete(res)
    if (clients.size === 0) ctx.eventClients.delete(channel)
  }
}

function publishEvent(ctx, channel, payload) {
  const backlog = pushBacklog(ctx.eventBacklog.get(channel) ?? [], payload)
  ctx.eventBacklog.set(channel, backlog)
  const clients = ctx.eventClients.get(channel)
  if (!clients) return
  const text = `event: message\ndata: ${JSON.stringify(payload)}\n\n`
  for (const client of clients) client.write(text)
}

/**
 * 处理 /api/* 请求。返回 true 表示已处理（含错误响应），false 表示非 /api（调用方走静态回退）。
 * [T-P1-419/AC1] 任何写锁超时（LockTimeoutError，statusCode=503）由内层 try/catch 映射为 503 fail-closed。
 */
export async function handleSharedApi(req, res, parsed, ctx) {
  if (!parsed.pathname.startsWith('/api/')) return false
  applyCors(res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return true
  }

  try {
    const eventMatch = parsed.pathname.match(/^\/api\/events\/([a-zA-Z0-9_-]+)$/)
    if (eventMatch) {
      const channel = safeName(eventMatch[1])
      if (req.method === 'DELETE') {
        if (channel === '_all') ctx.eventBacklog.clear()
        else ctx.eventBacklog.delete(channel)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end('{"ok":true}')
        return true
      }
      if (req.method === 'GET') {
        const remove = addEventClient(ctx, channel, res)
        req.on('close', remove)
        return true
      }
      if (req.method === 'POST') {
        const body = await readBody(req)
        const payload = JSON.parse(body.toString('utf8'))
        publishEvent(ctx, channel, payload)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end('{"ok":true}')
        return true
      }
    }

    const stateMatch = parsed.pathname.match(/^\/api\/state\/([a-zA-Z0-9_-]+)$/)
    if (stateMatch) {
      const name = safeName(stateMatch[1])
      const filePath = path.join(ctx.stateRoot, `${name}.json`)
      if (req.method === 'GET') {
        try {
          let data
          try {
            data = await readFile(filePath, 'utf8')
          } catch {
            data = await readFile(path.join(ctx.legacyStateRoot, `${name}.json`), 'utf8')
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(data)
        } catch {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end('null')
        }
        return true
      }
      if (req.method === 'PUT') {
        const auth = authorizeStateWrite(name, extractSecret(req))
        if (!auth.ok) {
          res.writeHead(auth.status, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'unauthorized' }))
          return true
        }
        await mkdir(ctx.stateRoot, { recursive: true })
        const body = await readBody(req)
        JSON.parse(body.toString('utf8'))
        await atomicWriteJsonStateFreshLocked(filePath, body)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end('{"ok":true}')
        return true
      }
      if (req.method === 'DELETE') {
        await rm(filePath, { force: true })
        await rm(path.join(ctx.legacyStateRoot, `${name}.json`), { force: true })
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end('{"ok":true}')
        return true
      }
    }

    const imageMatch = parsed.pathname.match(/^\/api\/images\/([a-zA-Z0-9_-]+)$/)
    if (imageMatch) {
      const id = safeName(imageMatch[1])
      const filePath = path.join(ctx.imageRoot, id)
      const metaPath = path.join(ctx.imageRoot, `${id}.json`)
      if (req.method === 'GET') {
        try {
          let sourcePath = filePath
          let sourceMetaPath = metaPath
          try {
            await readFile(metaPath, 'utf8')
          } catch {
            sourcePath = path.join(ctx.legacyImageRoot, id)
            sourceMetaPath = path.join(ctx.legacyImageRoot, `${id}.json`)
          }
          const meta = JSON.parse(await readFile(sourceMetaPath, 'utf8'))
          res.writeHead(200, { 'Content-Type': meta.type || 'application/octet-stream' })
          createReadStream(sourcePath).pipe(res)
        } catch {
          res.writeHead(404)
          res.end('Not Found')
        }
        return true
      }
      if (req.method === 'PUT') {
        await mkdir(ctx.imageRoot, { recursive: true })
        const body = await readBody(req, IMAGE_MAX_BYTES)
        const metaBody = JSON.stringify({ type: req.headers['content-type'] || 'application/octet-stream' })
        // [T-P1-419/AC3·AC4] blob+meta 在同一把锁内原子落盘。
        await atomicWriteImageLocked(filePath, metaPath, body, metaBody)
        // 写后即触发配额 GC（write-trigger，按 mtime 最旧优先淘汰）。
        await enforceImageQuota(ctx.imageRoot)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end('{"ok":true}')
        return true
      }
      if (req.method === 'DELETE') {
        await rm(filePath, { force: true })
        await rm(metaPath, { force: true })
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end('{"ok":true}')
        return true
      }
    }

    // 未匹配的 /api/* 不回落到静态 index.html（返回 404 JSON）。
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end('{"error":"Not Found"}')
    return true
  } catch (error) {
    const status = Number(error?.statusCode) || 500
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: String(error?.message ?? error) }))
    return true
  }
}

