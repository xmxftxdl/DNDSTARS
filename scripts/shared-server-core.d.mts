// [T11] shared-server-core.mjs 的类型声明（供 src/ 下 vitest 测试 import）。
export const STATE_MAX_BYTES: number
export const IMAGE_MAX_BYTES: number
export const EVENT_BACKLOG_LIMIT: number
export const EVENT_REPLAY_LIMIT: number
export const IMAGE_COUNT_LIMIT: number
export const LOCK_STALE_MS: number

export function withWriteLock<T>(filePath: string, fn: () => Promise<T>): Promise<T>
export function atomicWriteLocked(filePath: string, body: Buffer | Uint8Array | string): Promise<void>

export function safeName(value: unknown): string

export const PLAYER_WRITABLE_STATE: Set<string>
export function sharedSecret(): string | null
export function authEnabled(): boolean
export function authorizeStateWrite(
  resourceName: string,
  providedSecret: string | null,
): { ok: true } | { ok: false; status: number }
export function extractSecret(req: { headers?: Record<string, unknown> }): string | null

export function enforceImageQuota(imageRoot: string): Promise<string[]>

export function replaySlice<T>(backlog: T[]): T[]
export function pushBacklog<T>(backlog: T[], payload: T): T[]
