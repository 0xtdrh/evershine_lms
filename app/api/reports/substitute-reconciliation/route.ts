/**
 * GET /api/reports/substitute-reconciliation
 * Every CONFIRMED substitute assignment — the covering teacher earned an
 * extra session, the original teacher missed one. For each side it returns
 * the bonus/deduction already recorded (with its amount, so it can be shown
 * and removed) or, if none yet, a suggested amount: the GROUP's own
 * per-session rate (falling back to the teacher's default rate).
 * Restricted to roles that can edit fees — it exposes other teachers' pay.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { resolveGroupSessionRate } from '@/lib/groups/teacher-pay'
import { getSessionNumberForDate } from '@/lib/teachers/schedule'
import type { Role } from '@prisma/client'

export async function GET(_request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'fees', 'update')
  if (denied) return denied

  const campusId = campusScope(role, session.user.campusId, null)

  const rows = await prisma.substituteAssignment.findMany({
    where: {
      status: 'CONFIRMED',
      ...(campusId && { classSection: { campusId } }),
    },
    include: {
      classSection: { select: { id: true, className: true, sectionName: true, campusId: true } },
      originalTeacher: { select: { id: true, firstName: true, lastName: true } },
      substituteTeacher: { select: { id: true, firstName: true, lastName: true } },
      payAdjustments: { select: { id: true, teacherId: true, amount: true } },
      teacherAbsence: { select: { reason: true } },
    },
    orderBy: { date: 'desc' },
  })

  const result = []
  for (const r of rows) {
    const dateStr = r.date.toISOString().slice(0, 10)
    const [substituteRate, originalRate, sessionInfo] = await Promise.all([
      resolveGroupSessionRate(r.classSection.id, r.substituteTeacher.id),
      resolveGroupSessionRate(r.classSection.id, r.originalTeacher.id),
      getSessionNumberForDate(r.classSection.id, dateStr),
    ])
    const substituteAdj = r.payAdjustments.find((a) => a.teacherId === r.substituteTeacher.id)
    const originalAdj = r.payAdjustments.find((a) => a.teacherId === r.originalTeacher.id)

    result.push({
      id: r.id,
      date: r.date,
      groupLabel: `${r.classSection.className} ${r.classSection.sectionName}`,
      classSectionId: r.classSection.id,
      reason: r.teacherAbsence.reason,
      sessionNumber: sessionInfo?.sessionNumber ?? null,
      totalSessions: sessionInfo?.totalSessions ?? null,
      substituteTeacher: { id: r.substituteTeacher.id, name: `${r.substituteTeacher.firstName} ${r.substituteTeacher.lastName}` },
      originalTeacher: { id: r.originalTeacher.id, name: `${r.originalTeacher.firstName} ${r.originalTeacher.lastName}` },
      substituteAdjustment: substituteAdj ? { id: substituteAdj.id, amount: Number(substituteAdj.amount) } : null,
      originalAdjustment: originalAdj ? { id: originalAdj.id, amount: Number(originalAdj.amount) } : null,
      suggestedBonusAmount: substituteRate,
      suggestedDeductionAmount: originalRate,
    })
  }

  return successResponse(result)
}
