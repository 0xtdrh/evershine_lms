/**
 * Group progress sync — the automatic replacement for the old manual
 * "Month/Level finished" button.
 *
 * Called lazily (currently: whenever a group's detail is opened) rather than
 * from inside the attendance-marking flow, on purpose — it only READS
 * attendance records to count sessions, and never touches the existing
 * attendance-marking code path, to avoid risking that separate, already
 *-stable system.
 *
 * What it does, in order:
 * 1. Counts how many distinct session dates have happened in the group's
 *    current billing cycle (since currentCycleStartDate, falling back to
 *    startDate for a group's very first cycle).
 * 2. sessionsPerCycle = level.numberOfSessions / level.numberOfMonths
 *    (sessions expected in one "month" of this level).
 * 3. At the 50% checkpoint: any ACTIVE student without a paid invoice for
 *    this cycle is withdrawn with withdrawalReason "UNPAID_AUTO" — visibly
 *    reversible later via the reinstate endpoint, unlike a manual removal.
 * 4. At the 100% checkpoint: closes the cycle exactly like the old manual
 *    button did (MONTHLY bumps the cycle number; FULL_LEVEL advances to the
 *    next level, or the next course in the track, or completes the group),
 *    generates the next invoice for every student still active, and logs it.
 */

import { prisma } from '@/lib/prisma'
import { generateChallanNumber } from '@/lib/fees/challan-number'
import { getActiveAcademicYear } from '@/lib/academic/engine'

export interface SyncResult {
  checkedSessionsInCycle: number
  sessionsPerCycle: number
  withdrawnForNonPayment: string[] // student names
  cycleClosed: boolean
  cycleAction: 'MONTH_COMPLETED' | 'LEVEL_COMPLETED' | 'GROUP_COMPLETED' | null
}

async function isPaidEnough(
  studentId: string,
  classSectionId: string,
  cycleNumber: number | null,
  partialCounts: boolean
): Promise<boolean> {
  const invoice = await prisma.feeInvoice.findFirst({
    where: { studentId, classSectionId, cycleNumber },
  })
  if (!invoice) return false
  if (partialCounts) return Number(invoice.paidAmount) > 0
  return invoice.status === 'PAID'
}

async function createCycleInvoice(params: {
  studentId: string
  classSectionId: string
  levelId: string
  cycleNumber: number | null
  amount: number
  academicYearName: string
  issuedBy: string
  label: string
}) {
  const challanNumber = await generateChallanNumber(params.academicYearName)
  await prisma.feeInvoice.create({
    data: {
      challanNumber,
      studentId: params.studentId,
      month: params.label,
      academicYear: params.academicYearName,
      dueDate: new Date(),
      subtotal: params.amount,
      totalAmount: params.amount,
      status: 'ISSUED',
      issuedBy: params.issuedBy,
      classSectionId: params.classSectionId,
      levelId: params.levelId,
      cycleNumber: params.cycleNumber,
    },
  })
}

export async function syncGroupProgress(classSectionId: string, actingUserId: string): Promise<SyncResult> {
  const group = await prisma.classSection.findUnique({
    where: { id: classSectionId },
    include: {
      level: { include: { subject: true } },
      enrollments: { where: { status: 'ACTIVE' }, include: { student: { select: { id: true, firstName: true, lastName: true } } } },
    },
  })

  const empty: SyncResult = { checkedSessionsInCycle: 0, sessionsPerCycle: 0, withdrawnForNonPayment: [], cycleClosed: false, cycleAction: null }
  if (!group || !group.level || group.status === 'COMPLETED') return empty

  const cycleStart = group.currentCycleStartDate ?? group.startDate
  if (!cycleStart) return empty

  const records = await prisma.enrollmentAttendanceRecord.findMany({
    where: { studentEnrollment: { classSectionId }, attendanceDate: { gte: cycleStart } },
    select: { attendanceDate: true },
    distinct: ['attendanceDate'],
  })
  const sessionsSoFar = records.length
  const sessionsPerCycle = Math.max(1, Math.round(group.level.numberOfSessions / group.level.numberOfMonths))
  const checkpoint50 = sessionsPerCycle * 0.5

  const withdrawnNames: string[] = []

  // ── 50% checkpoint: withdraw anyone still unpaid for this cycle ─────────
  if (sessionsSoFar >= checkpoint50) {
    for (const e of group.enrollments) {
      const paid = await isPaidEnough(e.studentId, classSectionId, group.currentCycleNumber, group.partialPaymentCounts)
      if (!paid) {
        await prisma.studentEnrollment.update({
          where: { id: e.id },
          data: { status: 'WITHDRAWN', withdrawalReason: 'UNPAID_AUTO' },
        })
        withdrawnNames.push(`${e.student.firstName} ${e.student.lastName}`)
      }
    }
  }

  // ── 100% checkpoint: close the cycle ─────────────────────────────────────
  if (sessionsSoFar < sessionsPerCycle) {
    return { checkedSessionsInCycle: sessionsSoFar, sessionsPerCycle, withdrawnForNonPayment: withdrawnNames, cycleClosed: false, cycleAction: null }
  }

  const activeYear = await getActiveAcademicYear()
  const academicYearName = activeYear?.name ?? new Date().getFullYear().toString()
  const stillActiveStudentIds = withdrawnNames.length > 0
    ? group.enrollments.filter((e) => !withdrawnNames.includes(`${e.student.firstName} ${e.student.lastName}`)).map((e) => e.studentId)
    : group.enrollments.map((e) => e.studentId)

  if (group.level.pricingType === 'MONTHLY') {
    await prisma.groupCycleLog.create({
      data: { classSectionId, type: 'MONTH_COMPLETED', levelId: group.levelId, cycleNumber: group.currentCycleNumber, completedBy: actingUserId },
    })
    const nextCycleNumber = group.currentCycleNumber + 1
    await prisma.classSection.update({
      where: { id: classSectionId },
      data: { currentCycleNumber: { increment: 1 }, currentCycleStartDate: new Date() },
    })
    for (const studentId of stillActiveStudentIds) {
      await createCycleInvoice({
        studentId,
        classSectionId,
        levelId: group.levelId!,
        cycleNumber: nextCycleNumber,
        amount: Number(group.level.monthlyPrice ?? 0),
        academicYearName,
        issuedBy: actingUserId,
        label: `${group.level.subject.name} — ${group.level.name} — Month ${nextCycleNumber}`,
      })
    }
    return { checkedSessionsInCycle: sessionsSoFar, sessionsPerCycle, withdrawnForNonPayment: withdrawnNames, cycleClosed: true, cycleAction: 'MONTH_COMPLETED' }
  }

  // FULL_LEVEL — advance level/course, same rules as the old manual endpoint.
  let nextLevel = await prisma.level.findFirst({ where: { subjectId: group.level.subjectId, order: group.level.order + 1 } })
  if (!nextLevel && group.level.subject.trackId && group.level.subject.trackOrder != null) {
    const nextCourse = await prisma.academicSubject.findFirst({
      where: { trackId: group.level.subject.trackId, trackOrder: group.level.subject.trackOrder + 1 },
    })
    if (nextCourse) nextLevel = await prisma.level.findFirst({ where: { subjectId: nextCourse.id }, orderBy: { order: 'asc' } })
  }

  await prisma.groupCycleLog.create({
    data: { classSectionId, type: 'LEVEL_COMPLETED', levelId: group.levelId, completedBy: actingUserId },
  })

  if (!nextLevel) {
    await prisma.classSection.update({ where: { id: classSectionId }, data: { status: 'COMPLETED', completedAt: new Date() } })
    return { checkedSessionsInCycle: sessionsSoFar, sessionsPerCycle, withdrawnForNonPayment: withdrawnNames, cycleClosed: true, cycleAction: 'GROUP_COMPLETED' }
  }

  const expectedEndDate = new Date()
  expectedEndDate.setMonth(expectedEndDate.getMonth() + nextLevel.numberOfMonths)
  await prisma.classSection.update({
    where: { id: classSectionId },
    data: { levelId: nextLevel.id, currentCycleNumber: 1, currentCycleStartDate: new Date(), startDate: new Date(), expectedEndDate },
  })
  for (const studentId of stillActiveStudentIds) {
    await createCycleInvoice({
      studentId,
      classSectionId,
      levelId: nextLevel.id,
      cycleNumber: nextLevel.pricingType === 'MONTHLY' ? 1 : null,
      amount: Number(nextLevel.pricingType === 'MONTHLY' ? nextLevel.monthlyPrice ?? 0 : nextLevel.fullLevelPrice ?? 0),
      academicYearName,
      issuedBy: actingUserId,
      label: `${group.level.subject.name} — ${nextLevel.name}`,
    })
  }

  return { checkedSessionsInCycle: sessionsSoFar, sessionsPerCycle, withdrawnForNonPayment: withdrawnNames, cycleClosed: true, cycleAction: 'LEVEL_COMPLETED' }
}
