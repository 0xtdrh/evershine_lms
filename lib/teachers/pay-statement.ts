/**
 * Instructor pay statement — gathers one calendar month's facts from the system and runs the pure maths
 * (lib/teachers/pay-statement-calc.ts). Rules are explained there. Read-only.
 */

import { prisma } from '@/lib/prisma'
import { paidByTechNovaBetween, paidByTechNovaOn, pickPayRule } from '@/lib/teachers/employment'
import { sessionsPerCycle } from '@/lib/groups/cycle-rules'
import {
  monthBounds, preDiscountValue, round2, statementGroup, statementTotals,
  type PayRule, type StatementAdjustment, type StatementGroup, type StatementGroupFacts, type StatementSession, type StatementTotals,
} from './pay-statement-calc'

export interface PayStatement {
  teacher: { id: string; userId: string; name: string; employeeId: string | null }
  month: string
  scope: { campusId: string | null; groupId: string | null; label: string | null }
  groups: StatementGroup[]
  general: StatementAdjustment[]
  totals: StatementTotals
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const num = (v: unknown) => (v != null ? Number(v) : null)

/** The pay rule of one instructor in one group: group override → his rate in the group's place → his default. */
async function ruleFor(groupId: string, campusId: string, teacherId: string, teacherDefault: PayRule): Promise<PayRule> {
  const [offering, placeRow] = await Promise.all([
    prisma.subjectOffering.findFirst({ where: { classSectionId: groupId, teacherId }, orderBy: { createdAt: 'desc' }, select: { overrideFixedAmount: true, overridePercentOfStudentPayment: true, overridePerSessionAmount: true } }),
    prisma.teacherPlacePay.findUnique({ where: { teacherId_campusId: { teacherId, campusId } } }),
  ])
  const picked = pickPayRule<PayRule>(
    offering ? { fixed: num(offering.overrideFixedAmount), percent: num(offering.overridePercentOfStudentPayment), perSession: num(offering.overridePerSessionAmount) } : null,
    placeRow ? { fixed: num(placeRow.fixedAmount), percent: num(placeRow.percentOfStudentPayment), perSession: num(placeRow.perSessionAmount) } : null,
    teacherDefault,
  )
  return { fixed: num(picked.rule?.fixed), percent: num(picked.rule?.percent), perSession: num(picked.rule?.perSession) }
}

/**
 * @param groupFilter extra Prisma where for ClassSection (places of the person asking)
 */
export async function teacherPayStatement(
  teacherIdOrUserId: string,
  month: string,
  opts: { campusId?: string | null; groupId?: string | null; groupFilter?: Record<string, unknown> } = {},
): Promise<PayStatement | null> {
  const bounds = monthBounds(month)
  if (!bounds) return null
  const { from, to } = bounds
  const teacher = await prisma.teacher.findFirst({
    where: { OR: [{ id: teacherIdOrUserId }, { userId: teacherIdOrUserId }] },
    select: { id: true, userId: true, firstName: true, lastName: true, employeeId: true, defaultFixedAmount: true, defaultPercentOfStudentPayment: true, defaultPerSessionAmount: true },
  })
  if (!teacher) return null
  const tId = teacher.id
  const teacherDefault: PayRule = { fixed: num(teacher.defaultFixedAmount), percent: num(teacher.defaultPercentOfStudentPayment), perSession: num(teacher.defaultPerSessionAmount) }
  const periods = await prisma.teacherEmployment.findMany({ where: { teacherId: tId }, select: { employer: true, kind: true, fromDate: true, toDate: true } })

  const scopeWhere: Record<string, unknown>[] = []
  if (opts.groupId) scopeWhere.push({ id: opts.groupId })
  if (opts.campusId) scopeWhere.push({ campusId: opts.campusId })
  if (opts.groupFilter && Object.keys(opts.groupFilter).length) scopeWhere.push(opts.groupFilter)
  const groupSelect = {
    id: true, className: true, sectionName: true, campusId: true, startDate: true, expectedEndDate: true,
    campus: { select: { name: true } },
    level: { select: { numberOfSessions: true, numberOfMonths: true, pricingType: true } },
  } as const

  // his own groups + groups where he covered a session this month (substitute bonus)
  const [own, subAdj] = await Promise.all([
    prisma.classSection.findMany({ where: { AND: [{ subjectOfferings: { some: { teacherId: tId } } }, ...scopeWhere] }, select: groupSelect }),
    prisma.teacherPayAdjustment.findMany({
      where: { teacherId: tId, substituteAssignmentId: { not: null }, substituteAssignment: { date: { gte: from, lt: to } } },
      select: { amount: true, reason: true, classSectionId: true, substituteAssignment: { select: { date: true } } },
    }),
  ])
  const ownIds = new Set(own.map((g) => g.id))
  const coverIds = [...new Set(subAdj.map((a) => a.classSectionId).filter((x): x is string => !!x && !ownIds.has(x)))]
  const covered = coverIds.length ? await prisma.classSection.findMany({ where: { AND: [{ id: { in: coverIds } }, ...scopeWhere] }, select: groupSelect }) : []
  const groupsAll = [...own.map((g) => ({ g, coveredOnly: false })), ...covered.map((g) => ({ g, coveredOnly: true }))]

  const teacherNames = new Map<string, string>()
  const nameOf = async (id: string | null) => {
    if (!id) return null
    if (!teacherNames.has(id)) {
      const t = await prisma.teacher.findUnique({ where: { id }, select: { firstName: true, lastName: true } })
      teacherNames.set(id, t ? `${t.firstName} ${t.lastName}`.trim() : '—')
    }
    return teacherNames.get(id)!
  }

  const facts: StatementGroupFacts[] = []
  for (const { g, coveredOnly } of groupsAll) {
    const rule = coveredOnly ? { fixed: null, percent: null, perSession: null } : await ruleFor(g.id, g.campusId, tId, teacherDefault)

    // sessions: every held day of the group up to the end of the month (for numbering), credited teacher per day
    const [records, logs] = await Promise.all([
      prisma.enrollmentAttendanceRecord.findMany({
        where: { studentEnrollment: { classSectionId: g.id }, attendanceDate: { lt: to } },
        select: { attendanceDate: true, taughtByTeacherId: true, markedByTeacherId: true },
        orderBy: { attendanceDate: 'asc' },
      }),
      prisma.groupSessionLog.findMany({ where: { classSectionId: g.id, status: 'HELD', sessionDate: { lt: to } }, select: { sessionDate: true, taughtByTeacherId: true } }),
    ])
    const byDay = new Map<string, string | null>()
    for (const r of records) { const k = ymd(r.attendanceDate); if (!byDay.has(k)) byDay.set(k, r.taughtByTeacherId ?? r.markedByTeacherId ?? null) }
    for (const l of logs) { const k = ymd(l.sessionDate); if (!byDay.has(k)) byDay.set(k, l.taughtByTeacherId ?? null) }
    const days = [...byDay.keys()].sort()
    const of = g.level ? sessionsPerCycle(g.level) : null
    const sessions: StatementSession[] = []
    for (const [i, d] of days.entries()) {
      const date = new Date(`${d}T00:00:00Z`)
      if (date < from) continue
      const who = byDay.get(d) ?? null
      const mine = who === tId
      const paid = paidByTechNovaOn(periods, date)
      if (coveredOnly && !mine) continue
      sessions.push({ date: d, n: i + 1, of, counted: mine && paid, otherTeacher: mine ? null : await nameOf(who), notPaidByTechNova: mine && !paid })
    }

    // percent: money paid in the month on this group's invoices (before discount) minus refunds approved in the month
    const students: { student: string; preDiscountPaid: number }[] = []
    if (rule.percent) {
      const [pays, refunds, freeInvoices] = await Promise.all([
        prisma.feePayment.findMany({
          where: { status: 'COMPLETED', paymentDate: { gte: from, lt: to }, invoice: { classSectionId: g.id } },
          select: { amount: true, paymentDate: true, invoice: { select: { subtotal: true, totalAmount: true, student: { select: { id: true, firstName: true, lastName: true } } } } },
        }),
        // Refund has no relation to its invoice: match by the group's invoice ids
        prisma.feeInvoice.findMany({ where: { classSectionId: g.id }, select: { id: true, subtotal: true, totalAmount: true, student: { select: { id: true, firstName: true, lastName: true } } } })
          .then(async (invs) => {
            const byId = new Map(invs.map((i) => [i.id, i]))
            const rows = invs.length ? await prisma.refund.findMany({ where: { status: 'APPROVED', approvedAt: { gte: from, lt: to }, invoiceId: { in: [...byId.keys()] } }, select: { amount: true, approvedAt: true, invoiceId: true } }) : []
            return rows.map((r) => ({ ...r, invoice: byId.get(r.invoiceId)! }))
          }),
        // a 100% discount counts as fully paid (preDiscountCollected), in the month the invoice was made
        prisma.feeInvoice.findMany({
          where: { classSectionId: g.id, totalAmount: { lte: 0 }, status: { not: 'CANCELLED' }, createdAt: { gte: from, lt: to } },
          select: { subtotal: true, createdAt: true, student: { select: { id: true, firstName: true, lastName: true } } },
        }),
      ])
      const acc = new Map<string, { student: string; v: number }>()
      const add = (s: { id: string; firstName: string; lastName: string }, v: number) => {
        const cur = acc.get(s.id) ?? { student: `${s.firstName} ${s.lastName}`.trim(), v: 0 }
        cur.v = round2(cur.v + v); acc.set(s.id, cur)
      }
      for (const p of pays) if (paidByTechNovaOn(periods, p.paymentDate)) add(p.invoice.student, preDiscountValue(Number(p.amount), Number(p.invoice.subtotal), Number(p.invoice.totalAmount)))
      for (const r of refunds) if (r.approvedAt && paidByTechNovaOn(periods, r.approvedAt)) add(r.invoice.student, -preDiscountValue(Number(r.amount), Number(r.invoice.subtotal), Number(r.invoice.totalAmount)))
      for (const f of freeInvoices) if (paidByTechNovaOn(periods, f.createdAt)) add(f.student, Number(f.subtotal))
      for (const v of acc.values()) students.push({ student: v.student, preDiscountPaid: v.v })
    }

    const fixedCounts = !!rule.fixed && !!g.startDate && g.startDate >= from && g.startDate < to
      && paidByTechNovaBetween(periods, g.startDate, g.expectedEndDate ?? g.startDate)

    const manual = await prisma.teacherPayAdjustment.findMany({
      where: { teacherId: tId, classSectionId: g.id, substituteAssignmentId: null, createdAt: { gte: from, lt: to } },
      select: { amount: true, reason: true, createdAt: true },
    })
    const adjustments: StatementAdjustment[] = [
      ...manual.map((a) => ({ amount: Number(a.amount), reason: a.reason, date: ymd(a.createdAt), kind: 'MANUAL' as const })),
      ...subAdj.filter((a) => a.classSectionId === g.id).map((a) => ({ amount: Number(a.amount), reason: a.reason, date: ymd(a.substituteAssignment!.date), kind: 'SUBSTITUTE' as const })),
    ].sort((a, b) => a.date.localeCompare(b.date))

    if (!sessions.length && !students.length && !fixedCounts && !adjustments.length) continue
    facts.push({
      id: g.id, label: `${g.className} ${g.sectionName}`.trim(), place: g.campus?.name ?? '', campusId: g.campusId, coveredOnly,
      rule, fixedCounts, sessions, students, adjustments,
    })
  }

  // general adjustments (not tied to a group) only when the statement covers all his groups
  const general: StatementAdjustment[] = !opts.campusId && !opts.groupId
    ? (await prisma.teacherPayAdjustment.findMany({ where: { teacherId: tId, classSectionId: null, createdAt: { gte: from, lt: to } }, select: { amount: true, reason: true, createdAt: true } }))
      .map((a) => ({ amount: Number(a.amount), reason: a.reason, date: ymd(a.createdAt), kind: 'MANUAL' as const }))
    : []

  const groups = facts.map(statementGroup).sort((a, b) => Number(a.coveredOnly) - Number(b.coveredOnly) || a.label.localeCompare(b.label))
  let scopeLabel: string | null = null
  if (opts.groupId) scopeLabel = groupsAll.find((x) => x.g.id === opts.groupId)?.g ? `${groupsAll.find((x) => x.g.id === opts.groupId)!.g.className} ${groupsAll.find((x) => x.g.id === opts.groupId)!.g.sectionName}`.trim() : null
  else if (opts.campusId) scopeLabel = (await prisma.campus.findUnique({ where: { id: opts.campusId }, select: { name: true } }))?.name ?? null
  return {
    teacher: { id: tId, userId: teacher.userId, name: `${teacher.firstName} ${teacher.lastName}`.trim(), employeeId: teacher.employeeId ?? null },
    month,
    scope: { campusId: opts.campusId ?? null, groupId: opts.groupId ?? null, label: scopeLabel },
    groups,
    general,
    totals: statementTotals(groups, general),
  }
}
