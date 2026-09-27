/**
 * GET /api/reports/substitute-reconciliation
 * Every CONFIRMED substitute assignment — the covering teacher earned an
 * extra session, the original teacher missed one — with a flag for whether
 * a bonus/deduction has already been recorded for each side, so nothing
 * gets settled twice by accident.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { computeTeacherGroupPay } from '@/lib/groups/teacher-pay'
import type { Role } from '@prisma/client'

export async function GET(_request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'fees', 'read')
  if (denied) return denied

  const campusId = campusScope(role, session.user.campusId, null)

  const rows = await prisma.substituteAssignment.findMany({
    where: {
      status: 'CONFIRMED',
      ...(campusId && { classSection: { campusId } }),
    },
    include: {
      classSection: { select: { id: true, className: true, sectionName: true, campusId: true, currentCycleNumber: true } },
      originalTeacher: { select: { id: true, firstName: true, lastName: true } },
      substituteTeacher: { select: { id: true, firstName: true, lastName: true } },
      payAdjustments: { select: { id: true, teacherId: true, amount: true } },
      teacherAbsence: { select: { reason: true } },
    },
    orderBy: { date: 'desc' },
  })

  const result = []
  for (const r of rows) {
    const [substituteBreakdown, originalBreakdown] = await Promise.all([
      computeTeacherGroupPay(r.classSection.id, r.substituteTeacher.id, r.classSection.currentCycleNumber),
      computeTeacherGroupPay(r.classSection.id, r.originalTeacher.id, r.classSection.currentCycleNumber),
    ])
    result.push({
      id: r.id,
      date: r.date,
      groupLabel: `${r.classSection.className} ${r.classSection.sectionName}`,
      classSectionId: r.classSection.id,
      reason: r.teacherAbsence.reason,
      substituteTeacher: { id: r.substituteTeacher.id, name: `${r.substituteTeacher.firstName} ${r.substituteTeacher.lastName}` },
      originalTeacher: { id: r.originalTeacher.id, name: `${r.originalTeacher.firstName} ${r.originalTeacher.lastName}` },
      substituteBonusRecorded: r.payAdjustments.some((a) => a.teacherId === r.substituteTeacher.id),
      originalDeductionRecorded: r.payAdjustments.some((a) => a.teacherId === r.originalTeacher.id),
      suggestedBonusAmount: substituteBreakdown.perSessionAmount,
      suggestedDeductionAmount: originalBreakdown.perSessionAmount,
    })
  }

  return successResponse(result)
}
