import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// [T10/AC1 · E4] 角色 token 的血量真相源是 Character.currentHp；token.hp 只是它的单向镜像。
// 所有改血路径改完 character 后都经 characterHpTokenPatch 写回 token，保证 token.hp === currentHp。
// 这里走真实的 character store damage 改血路径，再断言镜像 helper 算出的 token patch 与 currentHp 一致。

// character store 的 saveCharacters 会 fire-and-forget 调 saveSharedResource，后者引用 window.location。
// 在 node 环境补一个最小 window + no-op fetch，避免 unhandled rejection 干扰（不影响被测逻辑）。
const hadWindow = 'window' in globalThis
const hadFetch = 'fetch' in globalThis

beforeAll(() => {
  if (!hadWindow) {
    const mem = new Map<string, string>()
    ;(globalThis as unknown as { window: unknown }).window = {
      location: { port: '5173', protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:5173' },
      setTimeout: (fn: () => void) => setTimeout(fn, 0),
      localStorage: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
        clear: () => mem.clear(),
        key: () => null,
        length: 0,
      },
    }
  }
  if (!hadFetch) {
    ;(globalThis as unknown as { fetch: unknown }).fetch = async () => ({ ok: false, json: async () => null })
  }
})

afterAll(() => {
  if (!hadWindow) delete (globalThis as unknown as { window?: unknown }).window
  if (!hadFetch) delete (globalThis as unknown as { fetch?: unknown }).fetch
})

describe('T10/AC1 — character currentHp mirrors to token.hp on the damage path', () => {
  it('after store.damage, characterHpTokenPatch(updated).hp === character.currentHp', async () => {
    const { useCharacterStore } = await import('./characters')
    const { characterHpTokenPatch } = await import('./maps')

    const id = useCharacterStore.getState().characters[0].id
    const before = useCharacterStore.getState().characters.find((c) => c.id === id)!
    const startHp = before.currentHp
    const startTemp = before.tempHp ?? 0

    // 真实改血路径
    useCharacterStore.getState().damage(id, 5)

    const updated = useCharacterStore.getState().characters.find((c) => c.id === id)!
    const patch = characterHpTokenPatch(updated)

    // 镜像不可被任何路径绕过：token.hp 必须等于角色 currentHp
    expect(patch.hp).toBe(updated.currentHp)
    expect(patch.maxHp).toBe(updated.maxHp)

    // 改血确实发生（临时血先扣，再扣 currentHp）
    const expectedHp = Math.max(0, startHp - Math.max(0, 5 - startTemp))
    expect(updated.currentHp).toBe(expectedHp)
  })
})
