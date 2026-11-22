/**
 * The short memory of the session guard (lib/session-guard.ts): who is still allowed, per person, kept 30 s.
 * Kept in its own file with NO imports so the database client can clear it on a write (lib/cache/flush-on-write.ts)
 * without a circular import. Final test A05 (22/11): after a password change / account stop the other devices stayed
 * signed in for up to 30 s because nobody cleared this memory — now any write on the User table clears it at once.
 */

export interface LiveState { isActive: boolean; role: string; sessionsRevokedAt: Date | null; signedOut?: Set<number> }
export const sessionCache = new Map<string, { at: number; live: LiveState | null }>()

/** Forget one person (or everybody when no id is given). */
export function forgetSessionState(userId?: string) {
  if (userId) sessionCache.delete(userId)
  else sessionCache.clear()
}
