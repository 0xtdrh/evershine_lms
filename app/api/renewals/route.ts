/**
 * GET /api/renewals — "continuing next month?" answers per group (phase A).
 * Only groups that are still ACTIVE and have requests. Includes the churn
 * summary (why students are not continuing) for the last 90 days.
 */

import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getRenewalSettings } from '@/lib/groups/renewal'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'renewals', 'read')
  if (denied) return denied
  const campusId = campusScope(role, session.user.campusId, null)

  const groups = await prisma.classSection.findMany({
    where: { status: 'ACTIVE', isActive: true, ...(campusId && { campusId }), id: { in: (await prisma.renewalRequest.findMany({ select: { classSectionId: true }, distinct: ['classSectionId'] })).map((r) => r.classSectionId) } },
    select: { id: true, className: true, sectionName: true, campus: { select: { name: true } }, level: { select: { name: true, subject: { select: { name: true } } } } },
  })
  const ids = groups.map((g) => g.id)
  const requests = await prisma.renewalRequest.findMany({ where: { classSectionId: { in: ids } }, orderBy: { createdAt: 'asc' } })
  const students = await prisma.student.findMany({
    where: { id: { in: [...new Set(requests.map((r) => r.studentId))] } },
    select: { id: true, firstName: true, lastName: true, registrationNumber: true, guardians: { select: { id: true, firstName: true, lastName: true, phoneNumber: true }, take: 1 } },
  })
  const S = new Map(students.map((s) => [s.id, s]))

  // churn: answers "NO" in the last 90 days, by reason (branch-scoped)
  const since = new Date(Date.now() - 90 * 86_400_000)
  const noRows = await prisma.renewalRequest.findMany({
    where: { status: 'NO', respondedAt: { gte: since }, ...(campusId && { classSectionId: { in: (await prisma.classSection.findMany({ where: { campusId }, select: { id: true } })).map((g) => g.id) } }) },
    select: { reason: true },
  })
  const reasons: Record<string, number> = {}
  for (const r of noRows) reasons[r.reason ?? 'OTHER'] = (reasons[r.reason ?? 'OTHER'] ?? 0) + 1

  return successResponse({
    settings: await getRenewalSettings(),
    churn: { since, total: noRows.length, reasons },
    groups: groups.map((g) => {
      const rows = requests.filter((r) => r.classSectionId === g.id)
      return {
        id: g.id,
        label: `${g.className} ${g.sectionName}`.trim(),
        campus: g.campus.name,
        course: g.level?.subject?.name ?? null,
        level: g.level?.name ?? null,
        counts: { yes: rows.filter((r) => r.status === 'YES').length, no: rows.filter((r) => r.status === 'NO').length, pending: rows.filter((r) => r.status === 'PENDING').length },
        students: rows.map((r) => {
          const s = S.get(r.studentId)
          const gd = s?.guardians[0]
          return {
            requestId: r.id,
            studentId: r.studentId,
            name: s ? `${s.firstName} ${s.lastName}` : '',
            firstName: s?.firstName ?? '',
            registrationNumber: s?.registrationNumber ?? '',
            guardian: gd ? { id: gd.id, name: `${gd.firstName} ${gd.lastName}`.trim(), phone: gd.phoneNumber } : null,
            status: r.status,
            reason: r.reason,
            reasonNote: r.reasonNote,
            respondedVia: r.respondedVia,
            respondedAt: r.respondedAt,
            earlyDiscount: !!r.discountAssignmentId,
          }
        }),
      }
    }),
  })
}
