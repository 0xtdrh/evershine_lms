/**
 * GET /api/today — 5-C "Your work today": the signed-in staff member's / instructor's tasks with counts
 * (lib/today/catalog.ts + lib/today/server.ts), limited to their places. Portal roles get an empty list.
 */

import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { PORTAL_ROLES } from '@/lib/places/rules'
import { todayTasks } from '@/lib/today/server'
import { cached } from '@/lib/cache/ttl'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (PORTAL_ROLES.includes(session.user.role)) return successResponse({ tasks: [] })
  // load test 22/11: ~45 counters (88 queries, 0.7 s) — kept 30 s per person (the card refreshes every 2 min anyway)
  return successResponse({ tasks: await cached(`today:${session.user.id}:${session.user.role}`, 30_000, () => todayTasks(session.user)) })
}
