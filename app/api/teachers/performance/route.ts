/**
 * R2: GET /api/teachers/performance?from&to[&teacherId] — instructor performance.
 * Managers: every instructor of their scope (table) or one (teacherId). Instructor: own only, when the setting allows.
 */

import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { prisma } from '@/lib/prisma'
import { performanceScope, performanceTable, teacherPerformance } from '@/lib/teachers/performance'

const DAY = 86_400_000
const parseDay = (s: string | null, end: boolean) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T${end ? '23:59:59.999' : '00:00:00.000'}Z`) : null)

export async function GET(req: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const user = { id: session.user.id, role: session.user.role as Role, campusId: session.user.campusId }
  const scope = await performanceScope(user)
  if (!scope) return errors.forbidden()
  const q = new URL(req.url).searchParams
  const to = parseDay(q.get('to'), true) ?? new Date()
  const from = parseDay(q.get('from'), false) ?? new Date(to.getTime() - 30 * DAY)
  if (from > to) return errors.badRequest('"From" must be before "to"')
  if (to.getTime() - from.getTime() > 186 * DAY) return errors.badRequest('The period can be at most 6 months')
  if (scope.own) {
    const p = await teacherPerformance((scope.teacherIds as string[])[0], from, to)
    return p ? successResponse({ own: true, rows: [p] }) : errors.notFound('Instructor')
  }
  const teacherId = q.get('teacherId')
  if (teacherId) {
    if (scope.campusId) {
      const t = await prisma.teacher.findUnique({ where: { id: teacherId }, select: { campusId: true } })
      if (t?.campusId !== scope.campusId) return errors.forbidden()
    }
    const p = await teacherPerformance(teacherId, from, to)
    return p ? successResponse({ own: false, rows: [p] }) : errors.notFound('Instructor')
  }
  return successResponse({ own: false, rows: await performanceTable(scope.campusId, from, to) })
}
