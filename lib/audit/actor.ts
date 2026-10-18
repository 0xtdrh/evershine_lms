/**
 * Who is acting in this request (signed-in user id), for the automatic change log (lib/audit/auto.ts). The value comes
 * from lib/permission-context.ts, which sets the provider; this file imports no app code so lib/prisma.ts can use it
 * without an import cycle.
 *
 * WHY runWithActor: Prisma runs an interactive transaction's callback outside the request's async context, so the
 * request store is lost there. lib/prisma.ts pins the actor read when $transaction is called around the callback.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

let provider: () => string | null = () => null
const pinned = new AsyncLocalStorage<string | null>()

export function setActorProvider(fn: () => string | null) {
  provider = fn
}

export function runWithActor<T>(actor: string | null, fn: () => T): T {
  return pinned.run(actor, fn)
}

export function currentActorId(): string | null {
  const p = pinned.getStore()
  if (p !== undefined) return p
  try { return provider() } catch { return null }
}
