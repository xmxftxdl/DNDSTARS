/// <reference types="node" />
// [T11/AC7] 端到端回归：真正起 static-server.mjs 子进程，over HTTP 验证。
// 强制要求：玩家 PUT 在 flag OFF 与 flag ON 两种状态下都成功。
// 另验：DM 权威资源 combat 的鉴权三分支、未匹配 /api/* → 404、超大 PUT → 413、并发写锁。
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..', '..')
const serverScript = path.join(repoRoot, 'scripts', 'static-server.mjs')
const HOST = '127.0.0.1'
const SECRET = 'test-secret-not-committed'

interface Running {
  proc: ChildProcess
  base: string
  sharedRoot: string
}

async function startServer(port: number, extraEnv: Record<string, string>): Promise<Running> {
  const sharedRoot = await mkdtemp(path.join(os.tmpdir(), 'stars-http-'))
  const distRoot = path.join(sharedRoot, 'dist')
  await mkdir(distRoot, { recursive: true })
  await writeFile(path.join(distRoot, 'index.html'), '<!doctype html><title>stars</title>')
  const proc = spawn(
    process.execPath,
    [serverScript, '--host', HOST, '--port', String(port), '--root', distRoot],
    {
      env: { ...process.env, STARS_SHARED_ROOT: sharedRoot, ...extraEnv },
      stdio: 'ignore',
    },
  )
  const base = `http://${HOST}:${port}`
  const deadline = Date.now() + 8000
  for (;;) {
    try {
      await fetch(`${base}/api/state/__probe__`)
      break
    } catch {
      if (Date.now() > deadline) throw new Error('static-server did not start in time')
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  return { proc, base, sharedRoot }
}

async function stopServer(r: Running): Promise<void> {
  r.proc.kill('SIGTERM')
  await rm(r.sharedRoot, { recursive: true, force: true }).catch(() => {})
}

function putState(base: string, name: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/state/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

let offServer: Running
let onServer: Running

beforeAll(async () => {
  // flag OFF：不带 STARS_SHARED_SECRET（必须显式从 env 里剔除，否则继承外层）。
  const offEnv = { ...process.env }
  delete offEnv.STARS_SHARED_SECRET
  offServer = await startServer(5392, { STARS_SHARED_SECRET: '' })
  onServer = await startServer(5393, { STARS_SHARED_SECRET: SECRET })
}, 30000)

afterAll(async () => {
  if (offServer) await stopServer(offServer)
  if (onServer) await stopServer(onServer)
})

describe('AC7 — 玩家 PUT 在两种 flag 状态都成功', () => {
  it('flag OFF：玩家写 characters ⇒ 200', async () => {
    const res = await putState(offServer.base, 'characters', { characters: [], updatedAt: Date.now() })
    expect(res.status).toBe(200)
  })

  it('flag OFF：DM combat（无 secret）⇒ 200（鉴权关闭，零回归）', async () => {
    const res = await putState(offServer.base, 'combat', { active: false })
    expect(res.status).toBe(200)
  })

  it('flag ON：玩家写 characters（无 secret）⇒ 200（白名单保留）', async () => {
    const res = await putState(onServer.base, 'characters', { characters: [], updatedAt: Date.now() })
    expect(res.status).toBe(200)
  })

  it('flag ON：玩家写 maps（无 secret）⇒ 200', async () => {
    const res = await putState(onServer.base, 'maps', { maps: [], updatedAt: Date.now() })
    expect(res.status).toBe(200)
  })
})

describe('AC2 — DM 权威资源鉴权（flag ON）', () => {
  it('combat 无 secret ⇒ 401', async () => {
    expect((await putState(onServer.base, 'combat', { active: false })).status).toBe(401)
  })
  it('combat 错 secret ⇒ 403', async () => {
    expect(
      (await putState(onServer.base, 'combat', { active: false }, { 'X-Stars-Secret': 'wrong' })).status,
    ).toBe(403)
  })
  it('combat 正确 secret ⇒ 200', async () => {
    expect(
      (await putState(onServer.base, 'combat', { active: false }, { 'X-Stars-Secret': SECRET })).status,
    ).toBe(200)
  })
})

describe('AC5/AC3/AC1 — 404 / 413 / 锁', () => {
  it('未匹配 /api/* ⇒ 404（非 index.html）', async () => {
    const res = await fetch(`${offServer.base}/api/does-not-exist`)
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('<!doctype')
  })

  it('超大 PUT ⇒ 413', async () => {
    const huge = 'x'.repeat(9 * 1024 * 1024)
    const res = await fetch(`${offServer.base}/api/state/characters`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blob: huge }),
    })
    expect(res.status).toBe(413)
  })

  it('两个并发 PUT 都落地为完整 JSON（AC1 锁）', async () => {
    await Promise.all([
      putState(offServer.base, 'maps', { maps: [{ id: 'a' }], updatedAt: 1 }),
      putState(offServer.base, 'maps', { maps: [{ id: 'b' }], updatedAt: 2 }),
    ])
    const data = await (await fetch(`${offServer.base}/api/state/maps`)).json()
    expect(Array.isArray(data.maps)).toBe(true)
  })
})
