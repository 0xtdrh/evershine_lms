/** POST /api/month-close/reopen { ym, campusId?, reason } — a03: reopen a closed month (Super Admin; the reason is kept). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { reopenMonth } from '@/lib/month-close/engine'
import { monthCloseError, monthCloseUser, scopeParam } from '@/lib/month-close/http'

const schema = z.object({ ym: z.string().regex(/^\d{4}-\d{2}$/), campusId: z.string().nullable().optional(), reason: z.string().max(1000) })

export async function POST(request: NextRequest) {
  const u = await monthCloseUser('approve')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try {
    const row = await reopenMonth(u.user, parsed.data.ym, scopeParam(parsed.data.campusId), parsed.data.reason)
    return successResponse({ id: row.id, status: row.status }, 'Month reopened · الشهر اتفتح')
  } catch (e) { return monthCloseError(e) }
}
