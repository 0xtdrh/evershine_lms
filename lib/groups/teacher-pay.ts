import { paidByTechNovaBetween, paidByTechNovaOn, pickPayRule } from '@/lib/teachers/employment'
import { prisma } from '@/lib/prisma'
import { resolveCycleStart } from './cycle-start'
import { preDiscountCollected } from '@/lib/discounts/calculate'

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
  source: 'GROUP_OVERRIDE' | 'PLACE_RATE' | 'TEACHER_DEFAULT' | 'NONE'
  /** M0: false when TechNova does not pay this instructor in this cycle (trainee / employed by a partner) */
  paidByTechNova?: boolean
}

/**
 * The per-session rate that applies to ONE session of this group,
 * regardless of who teaches it. Used to price substitute coverage: the
 * covering teacher's bonus and the absent teacher's deduction both use the
 * GROUP's own per-session rule (set via "Set this group's pay rule"),
 * because that's the price of the session itself. Only if the group has no
 * per-session rule does it fall back to the given teacher's own default.
 * Returns null when neither exists, so the accountant enters it manually.
 */
export async function resolveGroupSessionRate(classSectionId: string, teacherId: string): Promise<number | null> {
  const groupRule = await prisma.subjectOffering.findFirst({
    where: { classSectionId, overridePerSessionAmount: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { overridePerSessionAmount: true },
  })
  if (groupRule?.overridePerSessionAmount != null) return Number(groupRule.overridePerSessionAmount)

  // M0: the instructor's rate in this group's place
  const g = await prisma.classSection.findUnique({ where: { id: classSectionId }, select: { campusId: true } })
  const placeRate = g ? await prisma.teacherPlacePay.findUnique({ where: { teacherId_campusId: { teacherId, campusId: g.campusId } }, select: { perSessionAmount: true } }) : null
  if (placeRate?.perSessionAmount != null) return Number(placeRate.perSessionAmount)

  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherId },
    select: { defaultPerSessionAmount: true },
  })
  return teacher?.defaultPerSessionAmount != null ? Number(teacher.defaultPerSessionAmount) : null
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
  // M0: group override → the instructor's rate in this place → the instructor's default
  const groupPlace = await prisma.classSection.findUnique({ where: { id: classSectionId }, select: { campusId: true } })
  const placeRow = groupPlace ? await prisma.teacherPlacePay.findUnique({ where: { teacherId_campusId: { teacherId, campusId: groupPlace.campusId } } }) : null
  const picked = pickPayRule(
    offering ? { fixed: offering.overrideFixedAmount, percent: offering.overridePercentOfStudentPayment, perSession: offering.overridePerSessionAmount } : null,
    placeRow ? { fixed: placeRow.fixedAmount, percent: placeRow.percentOfStudentPayment, perSession: placeRow.perSessionAmount } : null,
    teacher ? { fixed: teacher.defaultFixedAmount, percent: teacher.defaultPercentOfStudentPayment, perSession: teacher.defaultPerSessionAmount } : null,
  )
  const source: TeacherPayBreakdown['source'] = picked.source
  const num = (v: unknown) => (v != null ? Number(v) : null)
  let fixedAmount = Number(picked.rule?.fixed ?? 0)
  const percentOfStudentPayment = num(picked.rule?.percent)
  const perSessionAmount = num(picked.rule?.perSession)
  // M0: trainee / partner periods are not paid by TechNova
  const periods = await prisma.teacherEmployment.findMany({ where: { teacherId }, select: { employer: true, kind: true, fromDate: true, toDate: true } })

  // Percent-of-payment component: what students paid on this cycle's invoices,
  // valued at the price BEFORE discounts (owner, 2026-10-02: the company bears
  // discounts, so they never reduce the teacher's share). Refunds DO reduce it:
  // the teacher gets a share of what the company keeps. See preDiscountCollected.
  const cycleGroup = await prisma.classSection.findUnique({ where: { id: classSectionId }, select: { currentCycleStartDate: true, startDate: true, expectedEndDate: true } })
  const cycleFrom = cycleGroup?.currentCycleStartDate ?? cycleGroup?.startDate ?? new Date()
  const paidInCycle = paidByTechNovaBetween(periods, cycleFrom, cycleGroup?.expectedEndDate ?? new Date())
  if (!paidInCycle) fixedAmount = 0
  let percentAmount = 0
  if (percentOfStudentPayment && paidInCycle) {
    const invoices = await prisma.feeInvoice.findMany({
      where: { classSectionId, cycleNumber },
      select: { paidAmount: true, refundedAmount: true, subtotal: true, totalAmount: true, status: true },
    })
    const collected = invoices.reduce(
      (sum, inv) =>
        sum + preDiscountCollected({ paidAmount: Number(inv.paidAmount) - Number(inv.refundedAmount), subtotal: Number(inv.subtotal), totalAmount: Number(inv.totalAmount), status: inv.status }),
      0
    )
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
    const cycleStart = group ? await resolveCycleStart(classSectionId, group.currentCycleStartDate, group.startDate) : null
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
      sessionsCounted = records.filter((r) => paidByTechNovaOn(periods, r.attendanceDate)).length
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
    paidByTechNova: paidInCycle,
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
