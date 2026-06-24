import { canWriteSharedState } from './appMode'

// [T11/AC2] DM 写共享态时附带的鉴权 secret。永远从环境读取，绝不硬编码/提交。
// 服务端 STARS_SHARED_SECRET 未设时此 header 被忽略（鉴权关闭，零回归）。
function sharedSecretHeader(): Record<string, string> {
  const secret = import.meta.env.VITE_STARS_SHARED_SECRET as string | undefined
  return secret ? { 'X-Stars-Secret': secret } : {}
}

// [T-P1-422/AC4] exported for the client-sync-layer unit test (dedup/trim/empty-filter of the
// configured base list — the routing core of read/double-send-write/single-canonical-event).
export function configuredApiBases(): string[] | null {
  const configured = import.meta.env.VITE_SHARED_API_BASES as string | undefined
  if (configured) {
    return configured
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
  }
  return null
}

function defaultDmApiBase(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:5173/api'
  const port = window.location.port.startsWith('617') ? '6173' : '5173'
  return `${window.location.protocol}//${window.location.hostname}:${port}/api`
}

function sameOriginApiBase(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:5173/api'
  const sameOrigin = `${window.location.origin}/api`
  return sameOrigin
}

function sharedApiCandidates(): string[] {
  const configured = configuredApiBases()
  if (configured) return configured
  return [defaultDmApiBase(), sameOriginApiBase()].filter((value, index, all) => all.indexOf(value) === index)
}

// [T-P1-422/AC4] state/image WRITES double-send to ALL configured bases (file-backed, idempotent —
// each process writes the same shared file root). Contrast sharedEventApiCandidates (single canonical).
export function sharedWriteApiCandidates(): string[] {
  const configured = configuredApiBases()
  if (configured) return configured
  return [defaultDmApiBase()]
}

// [T-P1-421/AC3·AC6 · Option A] 事件（SSE 订阅 + POST + DELETE）只走单一 canonical 端口（DM），
// 与 state/image 的「双发到所有端口」相反。生产 serve 模式下两个独立 static-server 各有一份进程内
// eventBacklog；若事件分发到多个端口，重连/迟到的一端会回放到另一份/空 backlog（C2 分歧 bug）。
// 路由到单一 canonical（已配置时取第一个=DM，否则 defaultDmApiBase）后，全端共享同一份 backlog。
// 注意：故意 NOT 复用 configured 全列表 —— 那正是分歧根因。
export function sharedEventApiCandidates(): string[] {
  const configured = configuredApiBases()
  if (configured && configured.length > 0) return [configured[0]]
  return [defaultDmApiBase()]
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  for (const api of sharedApiCandidates()) {
    try {
      const res = await fetch(`${api}${path}`, {
        ...init,
        headers: {
          ...(init?.body instanceof Blob ? {} : { 'Content-Type': 'application/json' }),
          ...(init?.headers ?? {}),
        },
      })
      if (!res.ok) continue
      return (await res.json()) as T
    } catch {
      // Try the next local endpoint. DM and player ports may be started independently.
    }
  }
  return null
}

export async function loadSharedResource<T>(name: string): Promise<T | null> {
  return requestJson<T>(`/state/${name}`)
}

async function sharedCombatIsActive(): Promise<boolean> {
  const combat = await requestJson<{ active?: boolean }>('/state/combat')
  return !!combat?.active
}

export async function saveSharedResource<T>(name: string, data: T): Promise<void> {
  if (!canWriteSharedState()) {
    if (
      name !== 'characters' &&
      name !== 'maps' &&
      name !== 'dodge' &&
      name !== 'gale-combo' &&
      name !== 'stable-mind' &&
      name !== 'player-action' &&
      name !== 'player-action-requests' &&
      name !== 'dice' &&
      name !== 'dice-events' &&
      name !== 'combat-log'
    ) return
    if ((name === 'characters' || name === 'maps') && (await sharedCombatIsActive())) return
  }
  await Promise.allSettled(
    sharedWriteApiCandidates().map((api) =>
      fetch(`${api}/state/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...sharedSecretHeader() },
        body: JSON.stringify(data),
      }),
    ),
  )
}

export async function publishSharedEvent<T>(channel: string, data: T): Promise<void> {
  await Promise.allSettled(
    sharedEventApiCandidates().map((api) =>
      fetch(`${api}/events/${encodeURIComponent(channel)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    ),
  )
}

export async function clearSharedEventBacklog(channels?: string[]): Promise<void> {
  const targets = channels && channels.length > 0 ? channels : ['_all']
  await Promise.allSettled(
    sharedEventApiCandidates().flatMap((api) =>
      targets.map((channel) =>
        fetch(`${api}/events/${encodeURIComponent(channel)}`, {
          method: 'DELETE',
        }),
      ),
    ),
  )
}

export async function clearSharedResource(name: string): Promise<void> {
  await Promise.allSettled(
    sharedWriteApiCandidates().map((api) =>
      fetch(`${api}/state/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      }),
    ),
  )
}

export function subscribeSharedEvent<T>(
  channel: string,
  onMessage: (data: T) => void,
): () => void {
  const sources: EventSource[] = []
  for (const api of sharedEventApiCandidates()) {
    try {
      const source = new EventSource(`${api}/events/${encodeURIComponent(channel)}`)
      source.addEventListener('message', (event) => {
        try {
          onMessage(JSON.parse(event.data) as T)
        } catch {
          // Ignore malformed local event payloads.
        }
      })
      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED) source.close()
      }
      sources.push(source)
    } catch {
      // Try every local endpoint that is available.
    }
  }
  return () => {
    for (const source of sources) source.close()
  }
}

export async function putSharedImage(id: string, blob: Blob): Promise<boolean> {
  if (!canWriteSharedState()) return false
  for (const api of sharedApiCandidates()) {
    try {
      const res = await fetch(`${api}/images/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob,
      })
      if (res.ok) return true
    } catch {
      // Try the next endpoint.
    }
  }
  return false
}

export async function getSharedImage(id: string): Promise<Blob | undefined> {
  for (const api of sharedApiCandidates()) {
    try {
      const res = await fetch(`${api}/images/${encodeURIComponent(id)}`)
      if (!res.ok) continue
      return await res.blob()
    } catch {
      // Try the next endpoint.
    }
  }
  return undefined
}

export async function deleteSharedImage(id: string): Promise<void> {
  if (!canWriteSharedState()) return
  await Promise.allSettled(
    sharedWriteApiCandidates().map((api) =>
      fetch(`${api}/images/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    ),
  )
}
