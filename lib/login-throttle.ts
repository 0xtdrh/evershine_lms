/**
 * Sign-in throttling: slows down password guessing. Server-only.
 *
 * WHY in our own database (not Upstash/Redis): the owner will move the system
 * from Vercel to Hostinger or another host later; this works anywhere with no
 * extra account. The load is tiny (only FAILED attempts are written).
 *
 * Rules (per 15 minutes):
 *  - 5 failed attempts on the same account  -> that account is locked 15 min,
 *    whatever device they come from (protects parents: their login is their
 *    phone number, which many people know).
 *  - 10 failed attempts from the same IP    -> that IP is locked 15 min.
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

const windowStart = () => new Date(Date.now() - LOCK_MINUTES * 60_000)

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

/** True if this account or this IP has too many recent failures. */
export async function isLoginLocked(identifier: string, ip: string): Promise<boolean> {
  try {
    const since = windowStart()
    const [byAccount, byIp] = await Promise.all([
      prisma.loginAttempt.count({ where: { identifier, createdAt: { gte: since } } }),
      ip === 'unknown' ? 0 : prisma.loginAttempt.count({ where: { ip, createdAt: { gte: since } } }),
    ])
    return byAccount >= MAX_FAILS_PER_ACCOUNT || byIp >= MAX_FAILS_PER_IP
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
  const since = windowStart()
  const [accounts, ips] = await Promise.all([
    prisma.loginAttempt.groupBy({
      by: ['identifier'], where: { createdAt: { gte: since } },
      _count: { _all: true }, _max: { createdAt: true },
    }),
    prisma.loginAttempt.groupBy({
      by: ['ip'], where: { createdAt: { gte: since }, ip: { not: 'unknown' } },
      _count: { _all: true }, _max: { createdAt: true },
    }),
  ])
  const until = (d: Date | null) => new Date((d ?? new Date()).getTime() + LOCK_MINUTES * 60_000).toISOString()
  return [
    ...accounts
      .filter((a) => a._count._all >= MAX_FAILS_PER_ACCOUNT)
      .map((a) => ({ kind: 'account' as const, value: a.identifier, failures: a._count._all, lockedUntil: until(a._max.createdAt) })),
    ...ips
      .filter((a) => a._count._all >= MAX_FAILS_PER_IP)
      .map((a) => ({ kind: 'ip' as const, value: a.ip, failures: a._count._all, lockedUntil: until(a._max.createdAt) })),
  ]
}

export async function unlock(kind: 'account' | 'ip', value: string): Promise<number> {
  const where = kind === 'account' ? { identifier: value } : { ip: value }
  return (await prisma.loginAttempt.deleteMany({ where })).count
}
