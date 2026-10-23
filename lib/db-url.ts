/**
 * 2026-10-24 (live test): "Too many database connections" on Aiven's free MySQL — every Vercel function instance opened
 * Prisma's default pool (2 × CPUs + 1 connections) and the small server limit ran out, so pages returned 500.
 * Each instance now opens a small pool; a request that needs more connections waits (pool_timeout) instead of failing.
 *
 * Portable: DB_CONNECTION_LIMIT / DB_POOL_TIMEOUT override it on any host (Hostinger VPS: one long-running process,
 * so a bigger number like 10 is fine). A URL that already has connection_limit is left as it is.
 * Pure (no imports) — lib/prisma.ts loads it with a relative import so tsx scripts keep working.
 */
export function withPoolLimits(url: string, env: Record<string, string | undefined>): string {
  if (/[?&]connection_limit=/.test(url)) return url
  const limit = env.DB_CONNECTION_LIMIT || (env.VERCEL ? '3' : '5')
  const timeout = env.DB_POOL_TIMEOUT || '20'
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}connection_limit=${encodeURIComponent(limit)}&pool_timeout=${encodeURIComponent(timeout)}`
}
