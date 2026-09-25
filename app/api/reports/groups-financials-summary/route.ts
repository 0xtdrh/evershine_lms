/**
 * GET /api/reports/groups-financials-summary
 * Aggregates every group's financials into per-branch totals and a
 * company-wide total: expected, collected, outstanding, teacher pay, and
 * profit. Campus-scoped like everything else — BRANCH_MANAGER/SECRETARY only
 * ever see their own branch's row.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { computeTeacherGroupPay } from '@/lib/groups/teacher-pay'
import type { Role } from '@prisma/client'

export async function GET(_request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'fees', 'read')
  if (denied) return denied

  const campusId = campusScope(role, session.user.campusId, null)
  const activeYear = await getActiveAcademicYear()

  const groups = await prisma.classSection.findMany({
    where: { isActive: true, ...(campusId && { campusId }) },
    select: {
      id: true,
      className: true,
      sectionName: true,
      currentCycleNumber: true,
      campus: { select: { id: true, name: true } },
      subjectOfferings: activeYear
        ? { where: { academicYearId: activeYear.id, teacherId: { not: null } }, orderBy: { createdAt: 'desc' }, take: 1, select: { teacherId: true } }
        : false,
      invoices: { select: { totalAmount: true, paidAmount: true } },
    },
  })

  const byBranch = new Map<
    string,
    { campusId: string; campusName: string; expected: number; collected: number; teacherPay: number; groupCount: number }
  >()

  for (const g of groups) {
    let expected = 0
    let collected = 0
    for (const inv of g.invoices) {
      expected += Number(inv.totalAmount)
      collected += Number(inv.paidAmount)
    }

    let teacherPay = 0
    const teacherId = g.subjectOfferings && g.subjectOfferings[0]?.teacherId
    if (teacherId) {
      const breakdown = await computeTeacherGroupPay(g.id, teacherId, g.currentCycleNumber)
      teacherPay = breakdown.total
    }

    const key = g.campus.id
    if (!byBranch.has(key)) {
      byBranch.set(key, { campusId: g.campus.id, campusName: g.campus.name, expected: 0, collected: 0, teacherPay: 0, groupCount: 0 })
    }
    const row = byBranch.get(key)!
    row.expected += expected
    row.collected += collected
    row.teacherPay += teacherPay
    row.groupCount += 1
  }

  const branches = Array.from(byBranch.values()).map((b) => ({
    ...b,
    outstanding: b.expected - b.collected,
    profit: b.collected - b.teacherPay,
  }))

  const company = branches.reduce(
    (acc, b) => ({
      expected: acc.expected + b.expected,
      collected: acc.collected + b.collected,
      outstanding: acc.outstanding + b.outstanding,
      teacherPay: acc.teacherPay + b.teacherPay,
      profit: acc.profit + b.profit,
      groupCount: acc.groupCount + b.groupCount,
    }),
    { expected: 0, collected: 0, outstanding: 0, teacherPay: 0, profit: 0, groupCount: 0 }
  )

  return successResponse({ branches, company })
}
