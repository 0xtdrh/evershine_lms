/**
 * LMS L3: groups the signed-in staff member grades homework for, with how many hand-ins wait to be graded.
 * Admins: every active group; branch manager: their branch; instructor: their groups + groups they substitute in.
 * Secretaries and other roles: none (403).
 */

import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { getTeacherByUserId, getTeacherClassSectionIds } from '@/lib/academic/teacher-scope'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role
  let where: Record<string, unknown> | null = null
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') where = {}
  else if (role === 'BRANCH_MANAGER') where = session.user.campusId ? { campusId: session.user.campusId } : {}
  else if (role === 'TEACHER') {
    const t = await getTeacherByUserId(session.user.id)
    if (!t) return successResponse([])
    const own = await getTeacherClassSectionIds(t.id)
    const subs = (await prisma.substituteAssignment.findMany({ where: { substituteTeacherId: t.id, status: 'CONFIRMED' }, select: { classSectionId: true } })).map((s) => s.classSectionId)
    where = { id: { in: [...new Set([...own, ...subs])] } }
  }
  if (!where) return errors.forbidden()
  const groups = await prisma.classSection.findMany({
    where: { ...where, status: 'ACTIVE', isActive: true, levelId: { not: null } },
    select: { id: true, className: true, sectionName: true, level: { select: { name: true, subject: { select: { name: true } } } } },
    orderBy: { className: 'asc' },
    take: 300,
  })
  const waiting = await prisma.assignmentSubmission.groupBy({ by: ['classSectionId'], where: { classSectionId: { in: groups.map((g) => g.id) }, status: 'SUBMITTED' }, _count: { _all: true } })
  return successResponse(groups.map((g) => ({
    id: g.id, label: `${g.className} ${g.sectionName}`.trim(), course: g.level?.subject?.name ?? '', level: g.level?.name ?? '',
    toGrade: waiting.find((w) => w.classSectionId === g.id)?._count._all ?? 0,
  })))
}
