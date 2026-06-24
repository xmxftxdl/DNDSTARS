import { afterEach, describe, expect, it, vi } from 'vitest'
import { sharedEventApiCandidates } from './sharedApi'

// [T-P1-421/AC3·AC6 · Option A] 事件（SSE + POST + DELETE）必须只走单一 canonical 端口，
// 否则生产 serve 模式两个独立 static-server 各自一份 eventBacklog 会分歧（C2 bug）。
describe('T-P1-421 — event topology routes to a single canonical base', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('AC3: no configured bases ⇒ exactly one canonical event base (default DM)', () => {
    vi.stubEnv('VITE_SHARED_API_BASES', '')
    const bases = sharedEventApiCandidates()
    expect(bases).toHaveLength(1)
  })

  it('AC6: even with MANY configured bases, events use ONLY the first (canonical DM) — no second backlog to diverge', () => {
    vi.stubEnv(
      'VITE_SHARED_API_BASES',
      'http://127.0.0.1:6173/api,http://127.0.0.1:6174/api,http://127.0.0.1:6175/api',
    )
    const bases = sharedEventApiCandidates()
    expect(bases).toEqual(['http://127.0.0.1:6173/api'])
  })
})
