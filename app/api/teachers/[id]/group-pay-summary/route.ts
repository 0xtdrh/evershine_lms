/**
 * GET /api/teachers/[id]/group-pay-summary
 * What this teacher has earned across all their currently-active groups
 * this cycle (per group, plus a total), and any pending manual bonus/
 * deduction adjustments not tied to one specific figure above. Meant to be
 * pulled into a Staff Salary Slip as custom fields — this endpoint only
 * reads, it never marks anything as "used", so the accountant reviewing the
 * slip is the one who avoids double-counting across multiple slips.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { computeTeacherGroupPay } from '@/lib/groups/teacher-pay'
import type { Role } from '@prisma/client'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'fees', 'read')
  if (denied) return denied

  const { id } = await params
  const teacher = await prisma.teacher.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true } })
  if (!teacher) return errors.notFound('Teacher')

  const offerings = await prisma.subjectOffering.findMany({
    where: { teacherId: id },
    distinct: ['classSectionId'],
    select: {
      classSectionId: true,
      classSection: {
        select: { id: true, className: true, sectionName: true, currentCycleNumber: true, isActive: true },
      },
    },
  })

  const groups = []
  let total = 0
  for (const o of offerings) {
    if (!o.classSection.isActive) continue
    const breakdown = await computeTeacherGroupPay(o.classSectionId, id, o.classSection.currentCycleNumber)
    if (breakdown.total === 0) continue
    groups.push({
      classSectionId: o.classSectionId,
      groupLabel: `${o.classSection.className} ${o.classSection.sectionName}`.trim(),
      ...breakdown,
    })
    total += breakdown.total
  }

  return successResponse({
    teacherName: `${teacher.firstName} ${teacher.lastName}`,
    groups,
    total,
  })
}
