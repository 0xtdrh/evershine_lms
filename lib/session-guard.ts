/**
 * Re-checks a signed-in session against the database. Server-only.
 *
 * WHY: sessions are JWTs that live up to 8 hours and carry the role from
 * sign-in time. Without this, a deactivated employee, a demoted role or a
 * changed password kept working until the token expired.
 *
 * Rules (applied in auth(), lib/auth.ts, i.e. on every API call):
 *  - account deleted or deactivated      -> no session (signed out)
 *  - signed in before sessionsRevokedAt  -> no session (password changed/reset)
 *  - role changed                        -> the session uses the current role
 * Cached per user for 30 s to avoid a query on every request. A database
 * error never signs anyone out (fails open, like the rest of auth).
 */

import { prisma } from '@/lib/prisma'
import type { Role } from '@prisma/client'

const TTL_MS = 30_000

interface Live { isActive: boolean; role: Role; sessionsRevokedAt: Date | null; signedOut?: Set<number> }

/**
 * Final test 15/11 (Z09): signing out used to leave the session cookie valid until it expired (8 h) — anyone who
 * copied it (shared computer, a stolen cookie) stayed signed in. Each sign-out now records that ONE session
 * (user + sign-in time) and it is refused from then on. Stored in RateLimitHit (kept 24 h > 8 h session life),
 * so no schema change. Other devices of the same person stay signed in.
 */
const SIGNED_OUT = 'signedout:'
export async function markSignedOut(userId: string, loginAt: number | undefined) {
  if (!userId || !loginAt) return
  try {
    await prisma.rateLimitHit.create({ data: { key: `${SIGNED_OUT}${userId}:${loginAt}`.slice(0, 191) } })
  } catch (err) { console.error('[SESSION_GUARD_SIGNOUT]', err) }
  forgetSessionState(userId)
}
const cache = new Map<string, { at: number; live: Live | null }>()

async function loadLive(userId: string): Promise<Live | null | undefined> {
  const hit = cache.get(userId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.live
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, role: true, sessionsRevokedAt: true },
    })
    // its own fail-open read: a problem here must never sign anyone out
    const outs = user ? await prisma.rateLimitHit.findMany({ where: { key: { startsWith: `${SIGNED_OUT}${userId}:` }, createdAt: { gte: new Date(Date.now() - 9 * 3_600_000) } }, select: { key: true } }).catch(() => []) : []
    const live: Live | null = user ? { ...user, signedOut: new Set(outs.map((o) => Number(o.key.split(':').pop()))) } : null
    cache.set(userId, { at: Date.now(), live })
    if (cache.size > 5000) cache.delete(cache.keys().next().value as string)
    return live
  } catch (err) {
    console.error('[SESSION_GUARD]', err)
    return undefined // unknown: keep the session as it is
  }
}

/** Forget the cached state of a user (call after changing it in this process). */
export function forgetSessionState(userId: string) {
  cache.delete(userId)
}

type SessionLike = { user?: { id?: string; role?: Role; loginAt?: number } | null } | null

/** Returns the session (role refreshed), or null when it must no longer be accepted. */
export async function guardSession<T extends SessionLike>(session: T): Promise<T | null> {
  const id = session?.user?.id
  if (!session || !id) return session
  const live = await loadLive(id)
  if (live === undefined) return session
  if (!live || !live.isActive) return null
  if (live.sessionsRevokedAt && (session.user?.loginAt ?? 0) < live.sessionsRevokedAt.getTime()) return null
  if (session.user?.loginAt && live.signedOut?.has(session.user.loginAt)) return null
  if (session.user && live.role !== session.user.role) {
    return { ...session, user: { ...session.user, role: live.role } } as T
  }
  return session
}

/** Signs out every existing session of this user (e.g. after a password change). */
export async function revokeSessions(userId: string, tx: Pick<typeof prisma, 'user'> = prisma) {
  await tx.user.update({ where: { id: userId }, data: { sessionsRevokedAt: new Date() } })
  forgetSessionState(userId)
}
