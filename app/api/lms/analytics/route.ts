/**
 * GET /api/lms/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&campusId&trackId&subjectId&levelId&teacherId
 * LMS analytics for admins, branch managers (own branch) and instructors (own groups). Default period: last 30 days.
 */

import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { ANALYTICS_ROLES, lmsAnalytics } from '@/lib/lms/analytics'

const DAY = 86_400_000
const parseDay = (s: string | null, end: boolean) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T${end ? '23:59:59.999' : '00:00:00.000'}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function GET(req: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  if (!ANALYTICS_ROLES.includes(role) || !checkPermission(role, 'curriculum', 'read')) return errors.forbidden()
  const q = new URL(req.url).searchParams
  const to = parseDay(q.get('to'), true) ?? new Date()
  const from = parseDay(q.get('from'), false) ?? new Date(to.getTime() - 30 * DAY)
  if (from > to) return errors.badRequest('"From" must be before "to"')
  if (to.getTime() - from.getTime() > 370 * DAY) return errors.badRequest('The period can be at most one year')
  const pick = (k: string) => q.get(k) || null
  const data = await lmsAnalytics(
    { id: session.user.id, role, campusId: session.user.campusId },
    { from, to, campusId: pick('campusId'), trackId: pick('trackId'), subjectId: pick('subjectId'), levelId: pick('levelId'), teacherId: pick('teacherId') },
  )
  return successResponse(data)
}
