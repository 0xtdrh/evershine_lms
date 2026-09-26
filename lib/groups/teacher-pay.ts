import { prisma } from '@/lib/prisma'

export interface TeacherPayBreakdown {
  fixedAmount: number
  percentOfStudentPayment: number | null
  percentAmount: number
  perSessionAmount: number | null
  sessionsCounted: number
  sessionAmount: number
  adjustmentsTotal: number
  adjustments: { id: string; amount: number; reason: string; createdAt: string }[]
  total: number
  source: 'GROUP_OVERRIDE' | 'TEACHER_DEFAULT' | 'NONE'
}

/**
 * Computes what a teacher has earned for one group's current billing cycle:
 * fixed + (percent of what students paid this cycle) + (flat amount per
 * session they actually taught, per attendance records) + manual
 * bonuses/deductions. A group-level override on its SubjectOffering wins
 * over the teacher's own default rule; if neither is set, everything is 0.
 */
export async function computeTeacherGroupPay(
  classSectionId: string,
  teacherId: string,
  cycleNumber: number | null
): Promise<TeacherPayBreakdown> {
  const offering = await prisma.subjectOffering.findFirst({
    where: { classSectionId, teacherId },
    orderBy: { createdAt: 'desc' },
    select: { overrideFixedAmount: true, overridePercentOfStudentPayment: true, overridePerSessionAmount: true },
  })

  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherId },
    select: { defaultFixedAmount: true, defaultPercentOfStudentPayment: true, defaultPerSessionAmount: true },
  })

  const hasOverride = offering && (
    offering.overrideFixedAmount != null ||
    offering.overridePercentOfStudentPayment != null ||
    offering.overridePerSessionAmount != null
  )

  const source: TeacherPayBreakdown['source'] = hasOverride ? 'GROUP_OVERRIDE' : teacher ? 'TEACHER_DEFAULT' : 'NONE'
  const fixedAmount = Number(hasOverride ? offering!.overrideFixedAmount ?? 0 : teacher?.defaultFixedAmount ?? 0)
  const percentOfStudentPayment = hasOverride
    ? offering!.overridePercentOfStudentPayment != null ? Number(offering!.overridePercentOfStudentPayment) : null
    : teacher?.defaultPercentOfStudentPayment != null ? Number(teacher.defaultPercentOfStudentPayment) : null
  const perSessionAmount = hasOverride
    ? offering!.overridePerSessionAmount != null ? Number(offering!.overridePerSessionAmount) : null
    : teacher?.defaultPerSessionAmount != null ? Number(teacher.defaultPerSessionAmount) : null

  // Percent-of-payment component: sum of what students actually paid this
  // cycle's invoices for this group.
  let percentAmount = 0
  if (percentOfStudentPayment) {
    const invoices = await prisma.feeInvoice.findMany({
      where: { classSectionId, cycleNumber },
      select: { paidAmount: true },
    })
    const collected = invoices.reduce((sum, inv) => sum + Number(inv.paidAmount), 0)
    percentAmount = Math.round(collected * (percentOfStudentPayment / 100) * 100) / 100
  }

  // Per-session component: distinct session dates this teacher marked
  // attendance for, within this cycle's window.
  let sessionsCounted = 0
  let sessionAmount = 0
  if (perSessionAmount) {
    const group = await prisma.classSection.findUnique({
      where: { id: classSectionId },
      select: { currentCycleStartDate: true, startDate: true },
    })
    const cycleStart = group?.currentCycleStartDate ?? group?.startDate
    if (cycleStart) {
      const records = await prisma.enrollmentAttendanceRecord.findMany({
        where: {
          studentEnrollment: { classSectionId },
          attendanceDate: { gte: cycleStart },
          OR: [{ taughtByTeacherId: teacherId }, { AND: [{ taughtByTeacherId: null }, { markedByTeacherId: teacherId }] }],
        },
        select: { attendanceDate: true },
        distinct: ['attendanceDate'],
      })
      sessionsCounted = records.length
      sessionAmount = Math.round(sessionsCounted * perSessionAmount * 100) / 100
    }
  }

  const adjustmentRows = await prisma.teacherPayAdjustment.findMany({
    where: { teacherId, classSectionId, ...(cycleNumber != null && { cycleNumber }) },
    orderBy: { createdAt: 'desc' },
    select: { id: true, amount: true, reason: true, createdAt: true },
  })
  const adjustments = adjustmentRows.map((a) => ({
    id: a.id,
    amount: Number(a.amount),
    reason: a.reason,
    createdAt: a.createdAt.toISOString(),
  }))
  const adjustmentsTotal = adjustments.reduce((sum, a) => sum + a.amount, 0)

  const total = Math.round((fixedAmount + percentAmount + sessionAmount + adjustmentsTotal) * 100) / 100

  return {
    fixedAmount,
    percentOfStudentPayment,
    percentAmount,
    perSessionAmount,
    sessionsCounted,
    sessionAmount,
    adjustmentsTotal,
    adjustments,
    total,
    source,
  }
}
