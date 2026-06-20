/// <reference types="node" />
// [T11] 服务端硬化核心的纯函数单测。直接 import scripts/shared-server-core.mjs。
import { mkdtemp, readFile, rm, writeFile, readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EVENT_BACKLOG_LIMIT,
  EVENT_REPLAY_LIMIT,
  IMAGE_COUNT_LIMIT,
  STATE_MAX_BYTES,
  atomicWriteLocked,
  authorizeStateWrite,
  enforceImageQuota,
  extractSecret,
  pushBacklog,
  replaySlice,
  safeName,
  withWriteLock,
} from '../../scripts/shared-server-core.mjs'

describe('safeName — AC5 防碰撞', () => {
  it('纯安全字符原样返回（无回归）', () => {
    expect(safeName('combat')).toBe('combat')
    expect(safeName('maps')).toBe('maps')
    expect(safeName('player-action-ack')).toBe('player-action-ack')
  })

  it('不同逻辑名不再折叠成同一文件名', () => {
    // 旧实现：'a/b' 与 'ab' 都 → 'ab'（碰撞）。新实现必不相等。
    expect(safeName('a/b')).not.toBe(safeName('ab'))
    expect(safeName('x.1')).not.toBe(safeName('x1'))
    expect(safeName('foo bar')).not.toBe(safeName('foobar'))
  })

  it('输出只含文件系统安全字符', () => {
    expect(safeName('a/b<>:c')).toMatch(/^[a-zA-Z0-9_-]+$/)
  })

  it('确定性：同输入同输出', () => {
    expect(safeName('a/b')).toBe(safeName('a/b'))
  })
})

describe('authorizeStateWrite — AC2 鉴权', () => {
  const prev = process.env.STARS_SHARED_SECRET
  afterEach(() => {
    if (prev == null) delete process.env.STARS_SHARED_SECRET
    else process.env.STARS_SHARED_SECRET = prev
  })

  it('(a) flag 未设 ⇒ 所有写放行（零回归锚点）', () => {
    delete process.env.STARS_SHARED_SECRET
    expect(authorizeStateWrite('combat', null).ok).toBe(true)
    expect(authorizeStateWrite('combat', 'whatever').ok).toBe(true)
    expect(authorizeStateWrite('characters', null).ok).toBe(true)
  })

  it('(b) flag 设 + 正确 secret + DM 资源 ⇒ 放行', () => {
    process.env.STARS_SHARED_SECRET = 's3cr3t'
    expect(authorizeStateWrite('combat', 's3cr3t').ok).toBe(true)
    expect(authorizeStateWrite('player-action-ack', 's3cr3t').ok).toBe(true)
  })

  it('(c) flag 设 + 缺/错 secret + DM 资源 ⇒ 401/403', () => {
    process.env.STARS_SHARED_SECRET = 's3cr3t'
    expect(authorizeStateWrite('combat', null)).toEqual({ ok: false, status: 401 })
    expect(authorizeStateWrite('combat', '')).toEqual({ ok: false, status: 401 })
    expect(authorizeStateWrite('combat', 'wrong')).toEqual({ ok: false, status: 403 })
  })

  it('(d) flag 设 + 玩家写白名单资源（无 secret）⇒ 仍放行', () => {
    process.env.STARS_SHARED_SECRET = 's3cr3t'
    for (const name of ['characters', 'maps', 'dodge', 'stable-mind', 'player-action', 'dice', 'dice-events', 'combat-log']) {
      expect(authorizeStateWrite(name, null).ok).toBe(true)
    }
  })

  it('extractSecret 从 x-stars-secret 头读取', () => {
    expect(extractSecret({ headers: { 'x-stars-secret': 'abc' } })).toBe('abc')
    expect(extractSecret({ headers: {} })).toBe(null)
  })
})

describe('backlog cap — AC3', () => {
  it('replaySlice 只取末尾 EVENT_REPLAY_LIMIT 条', () => {
    const backlog = Array.from({ length: 500 }, (_, i) => i)
    const slice = replaySlice(backlog)
    expect(slice.length).toBe(EVENT_REPLAY_LIMIT)
    expect(slice[slice.length - 1]).toBe(499)
    expect(EVENT_REPLAY_LIMIT).toBeLessThan(EVENT_BACKLOG_LIMIT)
  })

  it('短 backlog 全量返回', () => {
    expect(replaySlice([1, 2, 3])).toEqual([1, 2, 3])
  })

  it('pushBacklog 维持总量 ≤ EVENT_BACKLOG_LIMIT', () => {
    let b: number[] = []
    for (let i = 0; i < EVENT_BACKLOG_LIMIT + 50; i += 1) b = pushBacklog(b, i)
    expect(b.length).toBe(EVENT_BACKLOG_LIMIT)
    expect(b[b.length - 1]).toBe(EVENT_BACKLOG_LIMIT + 49)
  })

  it('STATE_MAX_BYTES 是正数上限', () => {
    expect(STATE_MAX_BYTES).toBeGreaterThan(0)
  })
})

describe('withWriteLock / atomicWriteLocked — AC1 锁', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'stars-lock-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('两个快速并发写都落地（不丢更新、不交错）', async () => {
    const file = path.join(dir, 'state.json')
    await Promise.all([
      atomicWriteLocked(file, Buffer.from(JSON.stringify({ v: 1 }))),
      atomicWriteLocked(file, Buffer.from(JSON.stringify({ v: 2 }))),
    ])
    const final = JSON.parse(await readFile(file, 'utf8'))
    // 最终内容是某个完整写（1 或 2），绝非半个文件交错。
    expect([1, 2]).toContain(final.v)
    // 锁文件已释放。
    await expect(stat(`${file}.lock`)).rejects.toBeTruthy()
  })

  it('串行化：N 个并发 increment 不丢更新', async () => {
    const file = path.join(dir, 'counter.json')
    await writeFile(file, JSON.stringify({ n: 0 }))
    const bump = () =>
      withWriteLock(file, async () => {
        const cur = JSON.parse(await readFile(file, 'utf8'))
        await writeFile(file, JSON.stringify({ n: cur.n + 1 }))
      })
    await Promise.all(Array.from({ length: 20 }, bump))
    const final = JSON.parse(await readFile(file, 'utf8'))
    expect(final.n).toBe(20)
  })

  it('fn 抛错也释放锁（不死锁）', async () => {
    const file = path.join(dir, 'err.json')
    await expect(
      withWriteLock(file, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await expect(stat(`${file}.lock`)).rejects.toBeTruthy()
    // 锁已释放，后续写正常。
    await atomicWriteLocked(file, Buffer.from('{"ok":1}'))
    expect(JSON.parse(await readFile(file, 'utf8')).ok).toBe(1)
  })
})

describe('enforceImageQuota — AC4 配额', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'stars-img-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('超过 IMAGE_COUNT_LIMIT 时按最旧优先 GC', async () => {
    const total = IMAGE_COUNT_LIMIT + 5
    for (let i = 0; i < total; i += 1) {
      const name = `img${String(i).padStart(3, '0')}`
      await writeFile(path.join(dir, name), Buffer.from(`data${i}`))
      await writeFile(path.join(dir, `${name}.json`), JSON.stringify({ type: 'image/png' }))
      // 强制 mtime 递增，确保 i 越小越旧。
      const t = new Date(Date.now() + i * 10)
      const { utimes } = await import('node:fs/promises')
      await utimes(path.join(dir, name), t, t)
    }
    const removed = await enforceImageQuota(dir)
    expect(removed.length).toBe(5)
    const remaining = (await readdir(dir)).filter((n) => !n.endsWith('.json'))
    expect(remaining.length).toBe(IMAGE_COUNT_LIMIT)
    // 最旧的 5 张（img000..img004）被删。
    expect(removed.sort()).toEqual(['img000', 'img001', 'img002', 'img003', 'img004'])
  })

  it('未超配额不删任何图片', async () => {
    await writeFile(path.join(dir, 'only'), Buffer.from('x'))
    await writeFile(path.join(dir, 'only.json'), '{}')
    expect(await enforceImageQuota(dir)).toEqual([])
  })
})
