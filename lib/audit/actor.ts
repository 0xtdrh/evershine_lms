/**
 * Who is acting in this request (signed-in user id), for the automatic change log (lib/audit/auto.ts). This file imports
 * nothing (it ends up in shared bundles through lib/prisma.ts); lib/permission-context.ts (server-only) plugs in the
 * request store and the transaction pinning.
 *
 * WHY pinning: Prisma runs an interactive transaction's callback outside the request's async context, so the request
 * store is lost there. lib/prisma.ts reads the actor when $transaction is called and pins it around the callback.
 */

type Runner = <T>(actor: string | null, fn: () => T) => T
let provider: () => string | null = () => null
let pinnedGetter: () => string | null | undefined = () => undefined
let runner: Runner = (_actor, fn) => fn()

export function setActorProvider(fn: () => string | null, pin?: { get: () => string | null | undefined; run: Runner }) {
  provider = fn
  if (pin) { pinnedGetter = pin.get; runner = pin.run }
}

export function runWithActor<T>(actor: string | null, fn: () => T): T {
  return runner(actor, fn)
}

export function currentActorId(): string | null {
  try {
    const p = pinnedGetter()
    if (p !== undefined) return p
    return provider()
  } catch { return null }
}
