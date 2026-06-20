import { createReadStream } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {
  IMAGE_MAX_BYTES,
  STATE_MAX_BYTES,
  atomicWriteLocked,
  authorizeStateWrite,
  enforceImageQuota,
  extractSecret,
  pushBacklog,
  replaySlice,
  safeName,
} from './shared-server-core.mjs'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i]
  const next = process.argv[i + 1]
  if (key.startsWith('--')) {
    args.set(key.slice(2), next && !next.startsWith('--') ? next : true)
    if (next && !next.startsWith('--')) i += 1
  }
}

const host = String(args.get('host') ?? '127.0.0.1')
const port = Number(args.get('port') ?? 5174)
const root = path.resolve(process.cwd(), String(args.get('root') ?? 'dist'))
const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`
const sharedRoot = process.env.STARS_SHARED_ROOT
  ? path.resolve(process.env.STARS_SHARED_ROOT)
  : path.resolve(
      process.env.LOCALAPPDATA ?? process.env.APPDATA ?? os.tmpdir(),
      'StarsApp',
      'shared',
    )
const stateRoot = path.join(sharedRoot, 'state')
const imageRoot = path.join(sharedRoot, 'images')
const legacySharedRoot = path.resolve(process.cwd(), '.stars-shared')
const legacyStateRoot = path.join(legacySharedRoot, 'state')
const legacyImageRoot = path.join(legacySharedRoot, 'images')
const eventClients = new Map()
const eventBacklog = new Map()

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
])

function resolveRequestPath(url) {
  const parsed = new URL(url, `http://${host}:${port}`)
  const decoded = decodeURIComponent(parsed.pathname)
  const normalized = path.normalize(decoded).replace(/^([/\\])+/, '')
  const filePath = path.resolve(root, normalized)
  if (filePath !== root && !filePath.startsWith(rootWithSeparator)) return null
  return filePath
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

// AC3：限制请求体大小，超过 maxBytes 即抛 413 标记错误。
// 注意：超限后继续把剩余分块吞掉（drain）而非 req.destroy()，否则会 ECONNRESET，
// 客户端拿不到干净的 413。drain 完再抛，让上层把 413 完整写回。
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

function addEventClient(channel, res) {
  const clients = eventClients.get(channel) ?? new Set()
  clients.add(res)
  eventClients.set(channel, clients)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })
  res.write(`event: ready\ndata: {"channel":"${channel}"}\n\n`)
  // AC3：只回放最近 EVENT_REPLAY_LIMIT 条，而非整 backlog。
  const backlog = replaySlice(eventBacklog.get(channel) ?? [])
  for (const payload of backlog) {
    res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)
  }
  return () => {
    clients.delete(res)
    if (clients.size === 0) eventClients.delete(channel)
  }
}

function publishEvent(channel, payload) {
  const backlog = pushBacklog(eventBacklog.get(channel) ?? [], payload)
  eventBacklog.set(channel, backlog)
  const clients = eventClients.get(channel)
  if (!clients) return
  const text = `event: message\ndata: ${JSON.stringify(payload)}\n\n`
  for (const client of clients) client.write(text)
}

async function handleApi(req, res, parsed) {
  setCors(res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return true
  }

  const eventMatch = parsed.pathname.match(/^\/api\/events\/([a-zA-Z0-9_-]+)$/)
  if (eventMatch) {
    const channel = safeName(eventMatch[1])
    if (req.method === 'DELETE') {
      if (channel === '_all') eventBacklog.clear()
      else eventBacklog.delete(channel)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end('{"ok":true}')
      return true
    }
    if (req.method === 'GET') {
      const remove = addEventClient(channel, res)
      req.on('close', remove)
      return true
    }
    if (req.method === 'POST') {
      const body = await readBody(req)
      const payload = JSON.parse(body.toString('utf8'))
      publishEvent(channel, payload)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end('{"ok":true}')
      return true
    }
  }

  const stateMatch = parsed.pathname.match(/^\/api\/state\/([a-zA-Z0-9_-]+)$/)
  if (stateMatch) {
    const name = safeName(stateMatch[1])
    const filePath = path.join(stateRoot, `${name}.json`)
    if (req.method === 'GET') {
      try {
        let data
        try {
          data = await readFile(filePath, 'utf8')
        } catch {
          data = await readFile(path.join(legacyStateRoot, `${name}.json`), 'utf8')
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
      // AC2：DM 权威资源鉴权（flag 未设则永远放行）。
      const auth = authorizeStateWrite(name, extractSecret(req))
      if (!auth.ok) {
        res.writeHead(auth.status, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'unauthorized' }))
        return true
      }
      await mkdir(stateRoot, { recursive: true })
      const body = await readBody(req)
      JSON.parse(body.toString('utf8'))
      // AC1：跨进程写锁 + 既有原子 temp+rename。
      await atomicWriteLocked(filePath, body)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end('{"ok":true}')
      return true
    }
    if (req.method === 'DELETE') {
      await rm(filePath, { force: true })
      await rm(path.join(legacyStateRoot, `${name}.json`), { force: true })
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end('{"ok":true}')
      return true
    }
  }

  const imageMatch = parsed.pathname.match(/^\/api\/images\/([a-zA-Z0-9_-]+)$/)
  if (imageMatch) {
    const id = safeName(imageMatch[1])
    const filePath = path.join(imageRoot, id)
    const metaPath = path.join(imageRoot, `${id}.json`)
    if (req.method === 'GET') {
      try {
        let sourcePath = filePath
        let sourceMetaPath = metaPath
        try {
          await readFile(metaPath, 'utf8')
        } catch {
          sourcePath = path.join(legacyImageRoot, id)
          sourceMetaPath = path.join(legacyImageRoot, `${id}.json`)
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
      await mkdir(imageRoot, { recursive: true })
      const body = await readBody(req, IMAGE_MAX_BYTES)
      await writeFile(filePath, body)
      await writeFile(metaPath, JSON.stringify({ type: req.headers['content-type'] || 'application/octet-stream' }))
      // AC4：写后即触发配额 GC（write-trigger，按 mtime 最旧优先淘汰）。
      await enforceImageQuota(imageRoot)
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

  // AC5：未匹配的 /api/* 不应回落到静态 index.html（旧 bug 返回 200）。返回 404。
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end('{"error":"Not Found"}')
  return true
}

async function findStaticFile(requestPath) {
  let filePath = requestPath
  try {
    const info = await stat(filePath)
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html')
    await stat(filePath)
    return filePath
  } catch {
    return path.join(root, 'index.html')
  }
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url ?? '/', `http://${host}:${port}`)
  if (parsed.pathname.startsWith('/api/')) {
    try {
      if (await handleApi(req, res, parsed)) return
    } catch (error) {
      setCors(res)
      const status = Number(error?.statusCode) || 500
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: String(error?.message ?? error) }))
      return
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end('Method Not Allowed')
    return
  }

  const requestPath = resolveRequestPath(req.url ?? '/')
  if (!requestPath) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  const filePath = await findStaticFile(requestPath)
  const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
})

server.listen(port, host, () => {
  console.log(`Static server listening on http://${host}:${port}/ from ${root}`)
})

setInterval(() => {}, 1 << 30)
