/**
 * GET /api/guardian-portal/renewals — "continuing next month?" questions for the
 * signed-in parent's children (open months only). Phase A.
 */

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { getChildrenForGuardianUser } from '@/lib/academic/guardian'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return errors.forbidden()
  const children = await getChildrenForGuardianUser(session.user.id)
  const ids = children.map((c) => c.id)
  if (!ids.length) return successResponse([])
  const rows = await prisma.renewalRequest.findMany({ where: { studentId: { in: ids } }, orderBy: { createdAt: 'desc' } })
  const groups = await prisma.classSection.findMany({
    where: { id: { in: rows.map((r) => r.classSectionId) }, status: 'ACTIVE' },
    select: { id: true, className: true, sectionName: true, level: { select: { name: true, subject: { select: { name: true } } } } },
  })
  const G = new Map(groups.map((g) => [g.id, g]))
  const C = new Map(children.map((c) => [c.id, c]))
  return successResponse(
    rows
      .filter((r) => G.has(r.classSectionId))
      .map((r) => {
        const g = G.get(r.classSectionId)!
        const c = C.get(r.studentId)
        return {
          id: r.id,
          studentId: r.studentId,
          studentName: c ? `${c.firstName} ${c.lastName}` : '',
          group: `${g.className} ${g.sectionName}`.trim(),
          course: g.level?.subject?.name ?? null,
          level: g.level?.name ?? null,
          status: r.status,
          reason: r.reason,
          respondedAt: r.respondedAt,
          earlyDiscount: !!r.discountAssignmentId,
        }
      })
  )
}
