import { paidByTechNovaBetween, paidByTechNovaOn, pickPayRule } from '@/lib/teachers/employment'
import { prisma } from '@/lib/prisma'
import { resolveCycleStart } from './cycle-start'
import { preDiscountCollected } from '@/lib/discounts/calculate'
import { groupIsOnline, groupParts, modeOfDay, onlineFrom, sessionRate, type RuleWithOnline } from '@/lib/teachers/online-pay'
import type { Mode } from '@/lib/delivery/modes'

export interface TeacherPayBreakdown {
  fixedAmount: number
  percentOfStudentPayment: number | null
  percentAmount: number
  perSessionAmount: number | null
  sessionsCounted: number
  /** a02 M1 batch 6: online sessions inside sessionsCounted, their rate, and recorded sessions (not paid per session) */
  onlineSessions?: number
  onlinePerSessionAmount?: number | null
  recordedSessions?: number
  groupOnline?: boolean
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
export async function resolveGroupSessionRate(classSectionId: string, teacherId: string, date?: string): Promise<number | null> {
  // a02 M1 batch 6: an ONLINE session is priced at the online rate (empty = the normal rate)
  let mode: Mode = 'BRANCH'
  if (date) {
    const [g0, o] = await Promise.all([
      prisma.classSection.findUnique({ where: { id: classSectionId }, select: { scheduleSlots: true } }),
      prisma.sessionModeOverride.findUnique({ where: { classSectionId_date: { classSectionId, date: new Date(`${date}T00:00:00Z`) } }, select: { mode: true } }),
    ])
    mode = modeOfDay(date, g0?.scheduleSlots, new Map(o ? [[date, o.mode]] : []))
  }
  const online = mode === 'ONLINE'
  const groupRule = await prisma.subjectOffering.findFirst({
    where: { classSectionId, OR: [{ overridePerSessionAmount: { not: null } }, ...(online ? [{ overrideOnlinePerSessionAmount: { not: null } }] : [])] },
    orderBy: { createdAt: 'desc' },
    select: { overridePerSessionAmount: true, overrideOnlinePerSessionAmount: true },
  })
  if (online && groupRule?.overrideOnlinePerSessionAmount != null) return Number(groupRule.overrideOnlinePerSessionAmount)
  if (groupRule?.overridePerSessionAmount != null) return Number(groupRule.overridePerSessionAmount)

  // M0: the instructor's rate in this group's place
  const g = await prisma.classSection.findUnique({ where: { id: classSectionId }, select: { campusId: true } })
  const placeRate = g ? await prisma.teacherPlacePay.findUnique({ where: { teacherId_campusId: { teacherId, campusId: g.campusId } }, select: { perSessionAmount: true, onlinePerSessionAmount: true } }) : null
  if (online && placeRate?.onlinePerSessionAmount != null) return Number(placeRate.onlinePerSessionAmount)
  if (placeRate?.perSessionAmount != null) return Number(placeRate.perSessionAmount)

  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherId },
    select: { defaultPerSessionAmount: true, defaultOnlinePerSessionAmount: true },
  })
  if (online && teacher?.defaultOnlinePerSessionAmount != null) return Number(teacher.defaultOnlinePerSessionAmount)
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
    select: { overrideFixedAmount: true, overridePercentOfStudentPayment: true, overridePerSessionAmount: true, overrideOnlineFixedAmount: true, overrideOnlinePercent: true, overrideOnlinePerSessionAmount: true },
  })

  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherId },
    select: { defaultFixedAmount: true, defaultPercentOfStudentPayment: true, defaultPerSessionAmount: true, defaultOnlineFixedAmount: true, defaultOnlinePercent: true, defaultOnlinePerSessionAmount: true },
  })
  // M0: group override → the instructor's rate in this place → the instructor's default
  const groupPlace = await prisma.classSection.findUnique({ where: { id: classSectionId }, select: { campusId: true, scheduleSlots: true, campus: { select: { kind: true } } } })
  const placeRow = groupPlace ? await prisma.teacherPlacePay.findUnique({ where: { teacherId_campusId: { teacherId, campusId: groupPlace.campusId } } }) : null
  const picked = pickPayRule(
    offering ? { fixed: offering.overrideFixedAmount, percent: offering.overridePercentOfStudentPayment, perSession: offering.overridePerSessionAmount, ...onlineFrom(offering.overrideOnlineFixedAmount, offering.overrideOnlinePercent, offering.overrideOnlinePerSessionAmount) } : null,
    placeRow ? { fixed: placeRow.fixedAmount, percent: placeRow.percentOfStudentPayment, perSession: placeRow.perSessionAmount, ...onlineFrom(placeRow.onlineFixedAmount, placeRow.onlinePercent, placeRow.onlinePerSessionAmount) } : null,
    teacher ? { fixed: teacher.defaultFixedAmount, percent: teacher.defaultPercentOfStudentPayment, perSession: teacher.defaultPerSessionAmount, ...onlineFrom(teacher.defaultOnlineFixedAmount, teacher.defaultOnlinePercent, teacher.defaultOnlinePerSessionAmount) } : null,
  )
  const source: TeacherPayBreakdown['source'] = picked.source
  const num = (v: unknown) => (v != null ? Number(v) : null)
  const r = picked.rule
  const rule: RuleWithOnline = {
    fixed: num(r?.fixed), percent: num(r?.percent), perSession: num(r?.perSession),
    onlineFixed: r?.onlineFixed ?? null, onlinePercent: r?.onlinePercent ?? null, onlinePerSession: r?.onlinePerSession ?? null,
  }
  // a02 M1 batch 6: an online group takes the online % / fixed amount
  const groupOnline = groupIsOnline(groupPlace?.campus?.kind, groupPlace?.scheduleSlots)
  const parts = groupParts(rule, groupOnline)
  let fixedAmount = Number(parts.fixed ?? 0)
  const percentOfStudentPayment = parts.percent
  const perSessionAmount = rule.perSession
  const onlinePerSessionAmount = sessionRate(rule, 'ONLINE')
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
  let onlineSessions = 0
  let recordedSessions = 0
  if (perSessionAmount || onlinePerSessionAmount) {
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
      // Partners part 1: sessions of classes without names (GroupSessionLog) count too
      const logged = await prisma.groupSessionLog.findMany({ where: { classSectionId, status: 'HELD', sessionDate: { gte: cycleStart }, taughtByTeacherId: teacherId }, select: { sessionDate: true } })
      const days = new Map<string, Date>()
      for (const d of [...records.map((r) => r.attendanceDate), ...logged.map((l) => l.sessionDate)]) days.set(d.toISOString().slice(0, 10), d)
      const overrides = new Map((await prisma.sessionModeOverride.findMany({ where: { classSectionId, date: { gte: cycleStart } }, select: { date: true, mode: true } })).map((o) => [o.date.toISOString().slice(0, 10), o.mode]))
      for (const [k, d] of days) {
        if (!paidByTechNovaOn(periods, d)) continue
        const mode = modeOfDay(k, groupPlace?.scheduleSlots, overrides)
        if (mode === 'RECORDED') { recordedSessions++; continue }
        sessionsCounted++
        if (mode === 'ONLINE') onlineSessions++
        sessionAmount += sessionRate(rule, mode) ?? 0
      }
      sessionAmount = Math.round(sessionAmount * 100) / 100
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
    onlineSessions,
    onlinePerSessionAmount,
    recordedSessions,
    groupOnline,
    sessionAmount,
    adjustmentsTotal,
    adjustments,
    total,
    source,
  }
}
