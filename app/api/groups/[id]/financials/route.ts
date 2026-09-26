/**
 * GET /api/groups/[id]/financials
 * Per-student payment ledger for this group (every invoice generated for
 * it, with its payments), plus group-level totals: expected, collected,
 * outstanding. Read-only — actual payment recording stays in the existing
 * accountant/fees flow, not duplicated here.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
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
  const group = await prisma.classSection.findUnique({ where: { id }, select: { campusId: true, currentCycleNumber: true } })
  if (!group) return errors.notFound('Group')

  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && group.campusId !== campusId) return errors.forbidden()

  const invoices = await prisma.feeInvoice.findMany({
    where: { classSectionId: id },
    orderBy: [{ studentId: 'asc' }, { cycleNumber: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      challanNumber: true,
      month: true,
      cycleNumber: true,
      totalAmount: true,
      paidAmount: true,
      status: true,
      dueDate: true,
      student: { select: { id: true, firstName: true, lastName: true, fullNameEn: true, registrationNumber: true } },
      payments: {
        select: { id: true, amount: true, paymentDate: true, paymentMethod: true, status: true },
        orderBy: { paymentDate: 'asc' },
      },
    },
  })

  const byStudent = new Map<
    string,
    { studentId: string; name: string; registrationNumber: string; invoices: typeof invoices }
  >()
  for (const inv of invoices) {
    const key = inv.student.id
    if (!byStudent.has(key)) {
      byStudent.set(key, {
        studentId: inv.student.id,
        name: inv.student.fullNameEn || `${inv.student.firstName} ${inv.student.lastName}`,
        registrationNumber: inv.student.registrationNumber,
        invoices: [],
      })
    }
    byStudent.get(key)!.invoices.push(inv)
  }

  let totalExpected = 0
  let totalCollected = 0
  for (const inv of invoices) {
    totalExpected += Number(inv.totalAmount)
    totalCollected += Number(inv.paidAmount)
  }

  // Teacher pay + profit — only computed when a teacher is actually
  // assigned; otherwise the group has no compensation to net against.
  let teacherPay = null
  const activeYear = await getActiveAcademicYear()
  const offering = activeYear
    ? await prisma.subjectOffering.findFirst({
        where: { classSectionId: id, academicYearId: activeYear.id, teacherId: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { teacherId: true, teacher: { select: { firstName: true, lastName: true } } },
      })
    : null
  if (offering?.teacherId) {
    const breakdown = await computeTeacherGroupPay(id, offering.teacherId, group.currentCycleNumber)
    teacherPay = {
      teacherId: offering.teacherId,
      teacherName: `${offering.teacher!.firstName} ${offering.teacher!.lastName}`,
      ...breakdown,
    }
  }

  const profit = totalCollected - (teacherPay?.total ?? 0)

  return successResponse({
    students: Array.from(byStudent.values()),
    totals: {
      expected: totalExpected,
      collected: totalCollected,
      outstanding: totalExpected - totalCollected,
      teacherPay: teacherPay?.total ?? 0,
      profit,
    },
    teacherPay,
  })
}
