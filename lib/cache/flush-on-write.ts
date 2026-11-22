/**
 * Load test 22/11: "your work today" and the dashboard numbers are kept a few seconds (lib/cache/ttl.ts). Any real
 * change in the data (a refund requested, a count approved…) forgets them at once, so nobody sees an old number after
 * acting. Busy bookkeeping tables that change all the time and never feed those numbers are ignored, else the cache
 * would be forgotten every second. Wired in lib/prisma.ts — RELATIVE imports only (tsx scripts load it).
 */

import type { PrismaClient } from '@prisma/client'
import { forgetCached } from './ttl'
import { forgetSessionState } from '../session-cache'

const WRITES = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'])
/** written on almost every request (sign-in checks, activity pings, logs, views) — they never change a task count */
const NOISY = new Set(['RateLimitHit', 'UserActivityDay', 'AuditLog', 'LessonView', 'VideoViewing', 'VideoWatch', 'OnlineJoin', 'CspReport', 'WebsiteVisit', 'DocumentCounter', 'Notification'])

export const CACHE_PREFIXES = ['today:', 'insights:']

export function withCacheFlush<T extends PrismaClient>(client: T): T {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const out = await query(args)
          // A05: a change on a User row (password, account stopped, role) must show in the session guard at once
          if (model === 'User' && WRITES.has(operation)) {
            const id = (args as { where?: { id?: string } })?.where?.id ?? (out as { id?: string } | null)?.id
            forgetSessionState(typeof id === 'string' ? id : undefined)
          }
          if (WRITES.has(operation) && !NOISY.has(model)) for (const p of CACHE_PREFIXES) forgetCached(p, true)
          return out
        },
      },
    },
  }) as unknown as T
}
