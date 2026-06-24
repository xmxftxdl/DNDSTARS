// [T11] shared-server-core.mjs 的类型声明（供 src/ 下 vitest 测试 import）。
export const STATE_MAX_BYTES: number
export const IMAGE_MAX_BYTES: number
export const EVENT_BACKLOG_LIMIT: number
export const EVENT_REPLAY_LIMIT: number
export const IMAGE_COUNT_LIMIT: number

export class LockTimeoutError extends Error {
  code: 'ELOCKTIMEOUT'
  statusCode: 503
}

export function withWriteLock<T>(filePath: string, fn: () => Promise<T>): Promise<T>
export function atomicWriteLocked(filePath: string, body: Buffer | Uint8Array | string): Promise<void>
export function atomicWriteJsonStateFreshLocked(
  filePath: string,
  body: Buffer | Uint8Array | string,
): Promise<boolean>
export function atomicWriteImageLocked(
  imagePath: string,
  metaPath: string,
  blob: Buffer | Uint8Array,
  metaBody: Buffer | Uint8Array | string,
): Promise<void>

export function handleSharedApi(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  parsed: URL,
  ctx: {
    stateRoot: string
    imageRoot: string
    legacyStateRoot: string
    legacyImageRoot: string
    eventClients: Map<string, Set<import('node:http').ServerResponse>>
    eventBacklog: Map<string, unknown[]>
  },
): Promise<boolean>

export function safeName(value: unknown): string

export function authorizeStateWrite(
  resourceName: string,
  providedSecret: string | null,
): { ok: true } | { ok: false; status: number }
export function extractSecret(req: { headers?: Record<string, unknown> }): string | null

export function enforceImageQuota(imageRoot: string): Promise<string[]>

export function replaySlice<T>(backlog: T[]): T[]
export function pushBacklog<T>(backlog: T[], payload: T): T[]
