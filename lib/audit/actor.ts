/**
 * Who is acting in this request (signed-in user id), for the automatic change log (lib/audit/auto.ts). The value comes
 * from lib/permission-context.ts, which sets the provider; this file imports nothing so lib/prisma.ts can use it
 * without an import cycle.
 */

let provider: () => string | null = () => null

export function setActorProvider(fn: () => string | null) {
  provider = fn
}

export function currentActorId(): string | null {
  try { return provider() } catch { return null }
}
