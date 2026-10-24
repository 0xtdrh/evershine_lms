/**
 * R1 session reports (staff).
 * GET ?groupId&date=YYYY-MM-DD — one session for the attendance screen panel (made on the fly when attendance exists).
 * GET ?from&to[&status&groupId] — list for the Session reports page, with what is missing + sessions without attendance.
 */

import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { missingAttendance, staffList, staffSession } from '@/lib/session-reports/engine'
import { cairoToday } from '@/lib/dates/cairo'

const DAY = 86_400_000
const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

export async function GET(req: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  if (!checkPermission(role, 'session_reports', 'read')) return errors.forbidden()
  const user = { id: session.user.id, role, campusId: session.user.campusId }
  const q = new URL(req.url).searchParams
  const groupId = q.get('groupId')
  const date = q.get('date')
  if (groupId && date) {
    if (!isDay(date)) return errors.badRequest('date must be YYYY-MM-DD')
    const r = await staffSession(user, groupId, date)
    if (!r.ok) return errors.forbidden((r as { message?: string }).message)
    return successResponse(r.value)
  }
  const toQ = q.get('to'), fromQ = q.get('from')
  const to = isDay(toQ) ? toQ : cairoToday()
  const from = isDay(fromQ) ? fromQ : new Date(Date.now() - 14 * DAY).toISOString().slice(0, 10)
  if (from > to) return errors.badRequest('"From" must be before "to"')
  const status = q.get('status')
  const [reports, noAttendance] = await Promise.all([
    staffList(user, { from, to, status: status === 'DRAFT' || status === 'SENT' ? status : null, groupId }),
    missingAttendance(user),
  ])
  return successResponse({ reports, noAttendance })
}
