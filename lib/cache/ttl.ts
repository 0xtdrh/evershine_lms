/**
 * A tiny in-memory cache with a time limit (load test 22/11). For screens many people open at once whose numbers may
 * be a few seconds old (dashboard numbers, "your work today"). Requests for the same key while one is running share it
 * (no stampede). A failed load is never kept. Per server process: on several servers each keeps its own copy.
 * Server-only.
 */

interface Entry { at: number; value: Promise<unknown> }
const store = new Map<string, Entry>()
const MAX = 2000

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>
  const value = load()
  store.set(key, { at: now, value })
  value.catch(() => { if (store.get(key)?.value === value) store.delete(key) })
  if (store.size > MAX) store.delete(store.keys().next().value as string)
  return value
}

/** Forget one key, or every key that starts with a prefix (e.g. after an action that changes the numbers). */
export function forgetCached(keyOrPrefix: string, prefix = false) {
  if (!prefix) { store.delete(keyOrPrefix); return }
  for (const k of store.keys()) if (k.startsWith(keyOrPrefix)) store.delete(k)
}
