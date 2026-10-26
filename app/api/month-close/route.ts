/**
 * GET  /api/month-close?months=12 — a03: the last finished months × the scopes this person sees (company, branches),
 *      closed / reopened / open, plus what this person may do. month_close:read (or financial_reports:read).
 * POST /api/month-close { ym, campusId? } — close a month (no campusId = whole company). month_close:create.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { checkPermission } from '@/lib/rbac'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { getMonthCloseSettings, listMonths, lockMonth } from '@/lib/month-close/engine'
import { monthCloseError, monthCloseUser, scopeParam } from '@/lib/month-close/http'

export async function GET(request: NextRequest) {
  const u = await monthCloseUser('read')
  if ('error' in u) return u.error
  const months = Number(request.nextUrl.searchParams.get('months') ?? 12) || 12
  const [list, settings] = await Promise.all([listMonths(u.user, months), getMonthCloseSettings()])
  return successResponse({
    ...list,
    settings,
    can: {
      close: checkPermission(u.user.role, 'month_close', 'create'),
      reopen: checkPermission(u.user.role, 'month_close', 'approve'),
      settings: ['SUPER_ADMIN', 'ADMIN'].includes(u.user.role) && checkPermission(u.user.role, 'month_close', 'create'),
    },
  })
}

const schema = z.object({ ym: z.string().regex(/^\d{4}-\d{2}$/), campusId: z.string().nullable().optional() })

export async function POST(request: NextRequest) {
  const u = await monthCloseUser('create')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try {
    const row = await lockMonth(u.user, parsed.data.ym, scopeParam(parsed.data.campusId))
    return createdResponse({ id: row.id, ym: row.ym, scopeKey: row.scopeKey, status: row.status }, 'Month closed · الشهر اتقفل')
  } catch (e) { return monthCloseError(e) }
}
