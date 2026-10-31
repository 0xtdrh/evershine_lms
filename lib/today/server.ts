/**
 * 5-C "Your work today": the count of every task in lib/today/catalog.ts for one person, limited to their places (M0)
 * or, for instructors, to their own groups. Only tasks the person may see are counted; zero tasks are dropped.
 * A counter that fails returns 0 (never breaks the dashboard). Server-only.
 */

import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { cairoToday } from '@/lib/dates/cairo'
import { loadPlaces, visibleGroupIds, visibleStudentIds } from '@/lib/places/server'
import { campusWhere, invoiceWhere, teacherWhere, type Places } from '@/lib/places/rules'
import { getTeacherByUserId, getTeacherClassSectionIds } from '@/lib/academic/teacher-scope'
import { occurrencesFor, type GroupOccurrences } from '@/lib/groups/occurrences'
import { birthdayPeople } from '@/lib/birthdays/birthdays'
import { pendingAcks } from '@/lib/announcements/engine'
import { getTreasurySettings } from '@/lib/treasury/engine'

/** Money accounts this person sees (their branches; company accounts only with every place). */
async function accountIds(c: { places: Places }) {
  return (await prisma.moneyAccount.findMany({ where: c.places.all ? {} : { campusId: { in: c.places.campusIds.length ? c.places.campusIds : ['__none__'] } }, select: { id: true } })).map((a) => a.id)
}
import { tasksFor, type TaskDef, type TaskKey } from './catalog'

export interface TodayTask { key: TaskKey; en: string; ar: string; href: string; urgent: boolean; count: number }

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const day = (d: string) => new Date(`${d}T00:00:00.000Z`)

interface Ctx {
  user: { id: string; role: string }
  places: Places
  today: string
  teacherId: string | null
  /** the instructor's own groups (instructors only) */
  myGroups: string[]
  groups: () => Promise<string[] | null>
  students: () => Promise<string[] | null>
  occ: () => Promise<GroupOccurrences[]>
}

const memo = <T,>(f: () => Promise<T>) => { let p: Promise<T> | null = null; return () => (p ??= f()) }
const inIds = (ids: string[] | null) => (ids ? { in: ids.length ? ids : ['__none__'] } : undefined)

const COUNTERS: Record<TaskKey, (c: Ctx) => Promise<number>> = {
  admissions: async (c) => prisma.admissionRequest.count({ where: { status: 'PENDING', ...(c.places.all ? {} : { OR: [{ preferredCampusId: null }, campusWhere(c.places, 'preferredCampusId')] }) } }),
  leads: async () => prisma.landingInquiry.count({ where: { status: 'NEW' } }),
  followUps: async (c) => prisma.contactLog.count({ where: { followUpAt: { lt: day(addDays(c.today, 1)) }, followUpDoneAt: null, ...campusWhere(c.places) } }),
  proofs: async (c) => prisma.feeInvoice.count({ where: { proofStatus: 'PENDING', ...invoiceWhere(c.places) } }),
  topUps: async (c) => prisma.walletTopUp.count({ where: { status: 'PENDING', ...(await studentIn(c)) } }),
  withdrawals: async (c) => prisma.walletWithdrawal.count({ where: { status: 'PENDING', ...(await studentIn(c)) } }),
  refunds: async (c) => prisma.refund.count({ where: { status: 'PENDING', ...(await studentIn(c)) } }),
  discounts: async (c) => {
    const [s, g] = [await c.students(), await c.groups()]
    return prisma.discountAssignment.count({ where: { status: 'PENDING', ...(s && g ? { OR: [{ studentId: inIds(s) }, { classSectionId: inIds(g) }] } : {}) } })
  },
  excuses: async (c) => prisma.absenceExcuse.count({ where: { status: 'PENDING', ...(await groupIn(c)) } }),
  complaintsLate: async (c) => prisma.complaint.count({ where: { status: { in: ['NEW', 'IN_PROGRESS'] }, dueAt: { lt: new Date() }, ...(c.places.all ? {} : { OR: [{ campusId: null }, campusWhere(c.places)] }) } }),
  complaintsMine: async (c) => prisma.complaint.count({ where: { status: { in: ['NEW', 'IN_PROGRESS'] }, assignedToId: c.user.id } }),
  absenceRequests: async (c) => prisma.teacherAbsence.count({ where: { status: 'PENDING', date: { gte: day(c.today) }, ...(c.places.all ? {} : { teacher: teacherWhere(c.places) }) } }),
  noSubstitute: async (c) => {
    const absences = await prisma.teacherAbsence.findMany({
      where: { status: 'APPROVED', date: { gte: day(c.today), lte: day(addDays(c.today, 7)) }, ...(c.places.all ? {} : { teacher: teacherWhere(c.places) }) },
      select: { teacherId: true, date: true, scope: true, classSectionId: true },
    })
    if (!absences.length) return 0
    let n = 0
    for (const a of absences) {
      const date = a.date.toISOString().slice(0, 10)
      const groupIds = a.scope === 'SINGLE_SESSION' && a.classSectionId ? [a.classSectionId] : await getTeacherClassSectionIds(a.teacherId)
      if (!groupIds.length) continue
      const occ = await occurrencesFor({ groupIds }, date, date)
      const subs = await prisma.substituteAssignment.findMany({ where: { classSectionId: { in: groupIds }, date: a.date, status: 'CONFIRMED' }, select: { classSectionId: true } })
      const covered = new Set(subs.map((s) => s.classSectionId))
      for (const g of occ) n += g.occurrences.filter((o) => o.date === date && (o.status === 'SCHEDULED' || o.status === 'NOT_STARTED') && !covered.has(g.id)).length
    }
    return n
  },
  leaves: async () => prisma.leaveRequest.count({ where: { status: 'PENDING' } }),
  missingAttendance: async (c) => {
    const y = addDays(c.today, -1)
    return (await c.occ()).reduce((s, g) => s + g.occurrences.filter((o) => o.date === y && o.status === 'MISSING').length, 0)
  },
  groupsToAdvance: async (c) => (await c.occ()).filter((g) => g.occurrences.some((o) => o.isLastOfCycle && o.status === 'HELD')).length,
  renewalsUnanswered: async (c) => prisma.renewalRequest.count({ where: { status: 'PENDING', ...(await groupIn(c)) } }),
  waitingList: async (c) => prisma.waitingListEntry.count({ where: { status: 'WAITING', ...campusWhere(c.places) } }),
  overdueInvoices: async (c) => prisma.feeInvoice.count({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] }, dueDate: { lt: day(c.today) }, ...invoiceWhere(c.places) } }),
  birthdays: async (c) => (await birthdayPeople({ days: 0, kinds: ['STUDENT'], ...(c.places.all ? {} : { groupIds: await c.groups() }) })).length,
  partnerStatements: async (c) => prisma.partnerStatement.count({ where: { status: 'DRAFT', ...(c.places.all ? {} : { OR: [{ campusId: null }, campusWhere(c.places)] }) } }),
  partnerContracts: async (c) => {
    const rows = await prisma.partnerContract.findMany({ where: { endDate: { gte: day(c.today), lte: day(addDays(c.today, 366)) } }, select: { endDate: true, alertDaysBefore: true } })
    return rows.filter((r) => r.endDate && r.endDate.toISOString().slice(0, 10) <= addDays(c.today, r.alertDaysBefore)).length
  },
  curriculumReview: async () => prisma.curriculumEdition.count({ where: { status: 'IN_REVIEW' } }),
  announcementsToApprove: async (c) => prisma.announcement.count({ where: { status: 'PENDING', isActive: true, createdBy: { not: c.user.id }, ...(c.places.all ? {} : { campusId: inIds(c.places.campusIds) }) } }),
  announcementsToConfirm: async (c) => pendingAcks(c.user.id),
  cashCountsToApprove: async (c) => prisma.cashCount.count({ where: { status: 'PENDING', countedById: { not: c.user.id }, accountId: { in: await accountIds(c) } } }),
  transfersToApprove: async (c) => prisma.moneyTransfer.count({ where: { status: 'PENDING', createdById: { not: c.user.id }, fromAccountId: { in: await accountIds(c) } } }),
  cashBoxesNotCounted: async (c) => {
    const s = await getTreasurySettings()
    const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false }))
    if (!s.dailyCloseRequired || hour < s.closeAfterHour) return 0
    const boxes = await prisma.moneyAccount.findMany({ where: { kind: 'CASH', isActive: true, id: { in: await accountIds(c) } }, select: { id: true } })
    if (!boxes.length) return 0
    const done = await prisma.cashCount.findMany({ where: { accountId: { in: boxes.map((b) => b.id) }, date: day(c.today) }, select: { accountId: true } })
    return boxes.filter((b) => !done.some((d) => d.accountId === b.id)).length
  },
  budgetOver: async (c) => (await import('@/lib/budget/engine')).overBudgetCount(c.user),
  cashForecastLow: async (c) => (await import('@/lib/finance/engine')).forecastNegativeCount(c.user),
  bankNotReconciled: async (c) => prisma.moneyMovement.count({ where: { reconciledAt: null, date: { lt: new Date(Date.now() - 7 * 86_400_000), gte: new Date(Date.now() - 90 * 86_400_000) }, account: { kind: { not: 'CASH' }, ...(c.places.all ? {} : { campusId: inIds(c.places.campusIds) }) } } }),
  monthNotClosed: async (c) => (await import('@/lib/month-close/engine')).lastMonthOpenCount(c.user),
  sessionsWithoutRoom: async (c) => {
    const places = await prisma.campus.findMany({ where: { roomMode: 'FIXED', isActive: true, ...(c.places.all ? {} : { id: inIds(c.places.campusIds) }) }, select: { id: true } })
    const { bookingsAt } = await import('@/lib/rooms/engine')
    let n = 0
    for (const p of places) n += (await bookingsAt(p.id)).filter((b) => !b.roomId).length
    return n
  },
  moneyNotPlaced: async (c) => prisma.moneyMovement.count({ where: { accountId: null, ...(c.places.all ? {} : { campusId: inIds(c.places.campusIds) }) } }),
  mySessionsToday: async (c) => (await c.occ()).reduce((s, g) => s + g.occurrences.filter((o) => o.date === c.today && ['SCHEDULED', 'NOT_STARTED', 'HELD'].includes(o.status)).length, 0),
  myMissingAttendance: async (c) => (await c.occ()).reduce((s, g) => s + g.occurrences.filter((o) => o.status === 'MISSING').length, 0),
  homeworkToGrade: async (c) => prisma.assignmentSubmission.count({ where: { status: 'SUBMITTED', classSectionId: inIds(c.teacherId ? c.myGroups : await c.groups()) ?? undefined } }),
  substituteRequests: async (c) => (c.teacherId ? prisma.substituteAssignment.count({ where: { substituteTeacherId: c.teacherId, status: 'PENDING_SUBSTITUTE_APPROVAL', date: { gte: day(c.today) } } }) : 0),
}

async function studentIn(c: Ctx) {
  const s = await c.students()
  return s ? { studentId: inIds(s) } : {}
}
async function groupIn(c: Ctx) {
  const g = await c.groups()
  return g ? { classSectionId: inIds(g) } : {}
}

/** The person's tasks for today (count > 0), urgent first. */
export async function todayTasks(user: { id: string; role: string }): Promise<TodayTask[]> {
  const role = user.role
  const defs: TaskDef[] = tasksFor(role, (r, a) => checkPermission(role, r, a))
  if (!defs.length) return []
  const today = cairoToday()
  const places = await loadPlaces(user)
  const teacher = role === 'TEACHER' ? await getTeacherByUserId(user.id) : null
  const myGroups = teacher ? await getTeacherClassSectionIds(teacher.id) : []
  const groups = memo(() => (teacher ? Promise.resolve(myGroups) : visibleGroupIds(places)))
  const ctx: Ctx = {
    user, places, today, teacherId: teacher?.id ?? null, myGroups, groups,
    students: memo(() => visibleStudentIds(places)),
    // sessions from 7 days ago to today: missing attendance (instructor: the last week), finished months, today's sessions
    occ: memo(async () => {
      const ids = await groups()
      if (ids && !ids.length) return []
      return occurrencesFor(ids ? { groupIds: ids } : {}, addDays(today, -7), today)
    }),
  }
  const out: TodayTask[] = []
  for (const d of defs) {
    let count = 0
    try { count = await COUNTERS[d.key](ctx) } catch (err) { console.error('[TODAY]', d.key, err) }
    if (count > 0) out.push({ key: d.key, en: d.en, ar: d.ar, href: d.href, urgent: !!d.urgent, count })
  }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent))
}
