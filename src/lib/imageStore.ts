// 用 IndexedDB 存储地图图片 Blob（图片可能很大，不适合放 localStorage）

import { deleteSharedImage, getSharedImage, putSharedImage } from './sharedApi'

const DB_NAME = 'stars-images'
const STORE = 'maps'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function putImage(id: string, blob: Blob): Promise<void> {
  await putSharedImage(id, blob)
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getImage(id: string): Promise<Blob | undefined> {
  const shared = await getSharedImage(id)
  if (shared) return shared
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve(req.result as Blob | undefined)
    req.onerror = () => reject(req.error)
  })
}

export async function deleteImage(id: string): Promise<void> {
  await deleteSharedImage(id)
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * [T11/AC4 · E9] 孤儿图片 GC（load-trigger）。
 * 选定的 GC 触发器：「玩家端在 maps 快照应用时」按现存 map id 集合清理本地 IndexedDB。
 * DM 删图会同步删服务端共享副本（deleteImage→deleteSharedImage），但玩家端 IndexedDB 里
 * 那份旧副本不会被告知删除 —— 这里在每次 maps 同步落地后，把不再属于任何 map 的本地图片删掉，
 * 闭合孤儿。不依赖服务端额外信令，纯客户端、幂等。
 */
export async function pruneOrphanImages(validIds: Iterable<string>): Promise<string[]> {
  const keep = new Set(validIds)
  const db = await openDB()
  const allKeys: string[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAllKeys()
    req.onsuccess = () => resolve((req.result as IDBValidKey[]).map((k) => String(k)))
    req.onerror = () => reject(req.error)
  })
  const orphans = allKeys.filter((key) => !keep.has(key))
  if (orphans.length === 0) return []
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const key of orphans) store.delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  return orphans
}
