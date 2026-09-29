/**
 * Group progress sync.
 *
 * IMPORTANT — this no longer closes cycles automatically. It used to
 * (auto-advance the month/level once enough sessions were marked), but that
 * removed staff from a decision that needs a human: exactly who is
 * continuing into the next month/level. That decision now happens through
 * the manual "advance cycle" endpoint (see advance-group-cycle.ts), which
 * only becomes available once this function reports isLastSessionOfCycle.
 *
 * Called lazily (currently: whenever a group's detail is opened). Only
 * READS attendance records to count sessions — never touches the
 * attendance-marking code path.
 *
 * What it does, in order:
 * 1. Counts how many distinct session dates have happened in the group's
 *    current cycle (since currentCycleStartDate, falling back to startDate
 *    for a group's very first cycle).
 * 2. sessionsPerCycle = level.numberOfSessions / level.numberOfMonths
 *    (sessions expected in one "month" of this level).
 * 3. At the 50% checkpoint: flags (does NOT withdraw) any ACTIVE student
 *    without a paid invoice for this cycle — sets withdrawalReason to a
 *    warning marker while leaving status ACTIVE, so it shows as a visible
 *    alert without removing anyone from the group.
 * 4. Reports whether the next session marked would be the last one of this
 *    cycle, so the UI knows when to offer the manual advance button.
 */

import { prisma } from '@/lib/prisma'
import { sessionsPerCycle as cycleSessionCount } from '@/lib/groups/cycle-rules'
import { generateChallanNumber } from '@/lib/fees/challan-number'
import { resolveCycleStart } from './cycle-start'

export interface SyncResult {
  checkedSessionsInCycle: number
  sessionsPerCycle: number
  flaggedForNonPayment: string[] // student names
  isLastSessionOfCycle: boolean
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

export async function createCycleInvoice(params: {
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

export async function syncGroupProgress(classSectionId: string, _actingUserId: string): Promise<SyncResult> {
  const group = await prisma.classSection.findUnique({
    where: { id: classSectionId },
    include: {
      level: true,
      enrollments: { where: { status: 'ACTIVE' }, include: { student: { select: { id: true, firstName: true, lastName: true } } } },
    },
  })

  const empty: SyncResult = { checkedSessionsInCycle: 0, sessionsPerCycle: 0, flaggedForNonPayment: [], isLastSessionOfCycle: false }
  if (!group || !group.level || group.status === 'COMPLETED') return empty

  const cycleStart = await resolveCycleStart(classSectionId, group.currentCycleStartDate, group.startDate)
  if (!cycleStart) return empty

  // First real session ever recorded for a group that hadn't "started" yet
  // (advance-cycle leaves startDate/expectedEndDate unset on purpose) — now
  // it has a real date, so make that official instead of leaving it blank
  // forever.
  // (expectedEndDate is no longer written: end dates are estimated live —
  // lib/groups/end-estimates.ts.)
  if (!group.startDate && !group.currentCycleStartDate) {
    await prisma.classSection.update({
      where: { id: classSectionId },
      data: { startDate: cycleStart, currentCycleStartDate: cycleStart },
    })
  }

  const records = await prisma.enrollmentAttendanceRecord.findMany({
    where: { studentEnrollment: { classSectionId }, attendanceDate: { gte: cycleStart } },
    select: { attendanceDate: true },
    distinct: ['attendanceDate'],
  })
  const sessionsSoFar = records.length
  const sessionsPerCycle = cycleSessionCount(group.level)
  const checkpoint50 = sessionsPerCycle * 0.5

  const flaggedNames: string[] = []

  // ── 50% checkpoint: FLAG (not withdraw) anyone still unpaid; clear the
  // flag automatically for anyone who has since caught up on payment ──────
  if (sessionsSoFar >= checkpoint50) {
    for (const e of group.enrollments) {
      const paid = await isPaidEnough(e.studentId, classSectionId, group.currentCycleNumber, group.partialPaymentCounts)
      if (!paid && e.withdrawalReason !== 'PAYMENT_OVERDUE_WARNING') {
        await prisma.studentEnrollment.update({
          where: { id: e.id },
          data: { withdrawalReason: 'PAYMENT_OVERDUE_WARNING' }, // status stays ACTIVE — this is a warning, not a removal
        })
        flaggedNames.push(`${e.student.firstName} ${e.student.lastName}`)
      } else if (paid && e.withdrawalReason === 'PAYMENT_OVERDUE_WARNING') {
        await prisma.studentEnrollment.update({ where: { id: e.id }, data: { withdrawalReason: null } })
      }
    }
  }

  return {
    checkedSessionsInCycle: sessionsSoFar,
    sessionsPerCycle,
    flaggedForNonPayment: flaggedNames,
    isLastSessionOfCycle: sessionsSoFar >= sessionsPerCycle,
  }
}
