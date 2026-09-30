/**
 * Sign-in throttling: slows down password guessing. Server-only.
 *
 * WHY in our own database (not Upstash/Redis): the owner will move the system
 * from Vercel to Hostinger or another host later; this works anywhere with no
 * extra account. The load is tiny (only FAILED attempts are written).
 *
 * Rules (see lockEndsAt):
 *  - 5 failed attempts on the same account within 15 min -> that account is
 *    locked for 15 min from the LAST failure, whatever device they come from
 *    (protects parents: their login is their phone number, which many know).
 *  - 10 failed attempts from the same IP within 15 min   -> that IP, likewise.
 *  A successful sign-in clears the account's counter. Super Admin can unlock
 *  from /dashboard/admin/login-locks.
 *
 * Fails OPEN: if the database check itself errors, sign-in continues as normal
 * (a broken limiter must never lock everyone out).
 */

import { prisma } from '@/lib/prisma'

export const LOCK_MINUTES = 15
export const MAX_FAILS_PER_ACCOUNT = 5
export const MAX_FAILS_PER_IP = 10
const KEEP_HOURS = 24

const LOCK_MS = LOCK_MINUTES * 60_000

/**
 * When a lock ends, given the newest failures (newest first, at most `max`).
 * Locked when the last `max` failures happened within 15 minutes of each other;
 * the lock then lasts 15 minutes from the LAST failure, so it always matches
 * the "paused for 15 minutes" message, however slowly the wrong passwords were
 * typed. Returns null when not locked.
 */
export function lockEndsAt(newestFirst: Date[], max: number, now = Date.now()): Date | null {
  if (newestFirst.length < max) return null
  const newest = newestFirst[0].getTime()
  const oldest = newestFirst[max - 1].getTime()
  if (newest - oldest > LOCK_MS) return null
  const until = newest + LOCK_MS
  return until > now ? new Date(until) : null
}

/** Only failures from the last 2 x 15 minutes can still cause a lock. */
const lookback = () => new Date(Date.now() - 2 * LOCK_MS)

async function recentFailures(where: { identifier: string } | { ip: string }, max: number): Promise<Date[]> {
  const rows = await prisma.loginAttempt.findMany({
    where: { ...where, createdAt: { gte: lookback() } },
    orderBy: { createdAt: 'desc' },
    take: max,
    select: { createdAt: true },
  })
  return rows.map((r) => r.createdAt)
}

/** Client IP from the proxy headers (Vercel / Hostinger both set x-forwarded-for). */
export function clientIp(request: Request | undefined): string {
  const h = request?.headers
  const forwarded = h?.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded || h?.get('x-real-ip')?.trim() || 'unknown'
  return ip.slice(0, 64)
}

export function accountKey(identifier: string): string {
  return identifier.trim().toLowerCase().slice(0, 191)
}

/** True if this account or this IP is locked right now. */
export async function isLoginLocked(identifier: string, ip: string): Promise<boolean> {
  try {
    const [byAccount, byIp] = await Promise.all([
      recentFailures({ identifier }, MAX_FAILS_PER_ACCOUNT),
      ip === 'unknown' ? Promise.resolve([] as Date[]) : recentFailures({ ip }, MAX_FAILS_PER_IP),
    ])
    return Boolean(lockEndsAt(byAccount, MAX_FAILS_PER_ACCOUNT) || lockEndsAt(byIp, MAX_FAILS_PER_IP))
  } catch (err) {
    console.error('[LOGIN_THROTTLE_CHECK]', err)
    return false
  }
}

export async function recordLoginFailure(identifier: string, ip: string): Promise<void> {
  try {
    await prisma.loginAttempt.create({ data: { identifier, ip } })
    await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_HOURS * 3_600_000) } } })
  } catch (err) {
    console.error('[LOGIN_THROTTLE_RECORD]', err)
  }
}

export async function clearLoginFailures(identifier: string): Promise<void> {
  try {
    await prisma.loginAttempt.deleteMany({ where: { identifier } })
  } catch (err) {
    console.error('[LOGIN_THROTTLE_CLEAR]', err)
  }
}

export interface LockRow { kind: 'account' | 'ip'; value: string; failures: number; lockedUntil: string }

/** Accounts and IPs that are locked right now (for the Super Admin page). */
export async function listLocks(): Promise<LockRow[]> {
  const since = lookback()
  const [accounts, ips] = await Promise.all([
    prisma.loginAttempt.groupBy({ by: ['identifier'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.loginAttempt.groupBy({ by: ['ip'], where: { createdAt: { gte: since }, ip: { not: 'unknown' } }, _count: { _all: true } }),
  ])
  const rows: LockRow[] = []
  for (const a of accounts.filter((x) => x._count._all >= MAX_FAILS_PER_ACCOUNT)) {
    const until = lockEndsAt(await recentFailures({ identifier: a.identifier }, MAX_FAILS_PER_ACCOUNT), MAX_FAILS_PER_ACCOUNT)
    if (until) rows.push({ kind: 'account', value: a.identifier, failures: a._count._all, lockedUntil: until.toISOString() })
  }
  for (const a of ips.filter((x) => x._count._all >= MAX_FAILS_PER_IP)) {
    const until = lockEndsAt(await recentFailures({ ip: a.ip }, MAX_FAILS_PER_IP), MAX_FAILS_PER_IP)
    if (until) rows.push({ kind: 'ip', value: a.ip, failures: a._count._all, lockedUntil: until.toISOString() })
  }
  return rows
}

export async function unlock(kind: 'account' | 'ip', value: string): Promise<number> {
  const where = kind === 'account' ? { identifier: value } : { ip: value }
  return (await prisma.loginAttempt.deleteMany({ where })).count
}
