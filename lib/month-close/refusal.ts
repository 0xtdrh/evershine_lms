/**
 * a03: the error thrown when a write hits a closed month, and a short memory of it so `errors.internal()` can answer
 * 409 MONTH_LOCKED with the real message (most routes catch everything and return a generic 500).
 * Keyed by the acting person (lib/audit/actor.ts, kept inside transactions). Imports nothing heavy: lib/prisma.ts and
 * lib/api-response.ts load it.
 */

import { currentActorId } from '../audit/actor'

export class MonthLockedError extends Error {
  readonly code = 'MONTH_LOCKED'
  constructor(readonly ym: string, message: string) { super(message) }
}

const recent = new Map<string, { at: number; err: MonthLockedError }>()
const KEEP_MS = 10_000

export function noteRefusal(err: MonthLockedError) {
  recent.set(currentActorId() ?? 'system', { at: Date.now(), err })
  if (recent.size > 500) recent.delete(recent.keys().next().value as string)
}

/** The refusal this person just hit (once), if any. */
export function takeRecentRefusal(): MonthLockedError | null {
  const key = currentActorId() ?? 'system'
  const hit = recent.get(key)
  if (!hit) return null
  recent.delete(key)
  return Date.now() - hit.at < KEEP_MS ? hit.err : null
}

export const isMonthLocked = (e: unknown): e is MonthLockedError => e instanceof MonthLockedError || (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'MONTH_LOCKED')
