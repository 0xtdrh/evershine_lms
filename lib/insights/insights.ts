/**
 * Phase C: the numbers each role sees first on the dashboard, and the managers'
 * morning summary (docs/design-phase-c.md). Branch-scoped when campusId is set.
 * Server-only.
 */

import { prisma } from '@/lib/prisma'
import { cairoYmd, ymdKey, addDays } from '@/lib/dates/cairo'
import { occurrencesFor } from '@/lib/groups/occurrences'
import { prepaidTotal } from '@/lib/wallet/engine'
import { birthdayPeople } from '@/lib/birthdays/birthdays'

export interface Metric { key: string; label: string; value: number | string; hint?: string; href?: string; tone?: 'good' | 'warn' | 'bad' }

const num = (v: unknown) => Number(v ?? 0)
const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} EGP`

function periods() {
  const t = cairoYmd()
  const today = new Date(`${ymdKey(t)}T00:00:00.000Z`)
  const monthStart = new Date(Date.UTC(t.y, t.m - 1, 1))
  const yesterday = ymdKey(addDays(t, -1))
  return { t, today, todayKey: ymdKey(t), monthStart, yesterday }
}

const studentFilter = (campusId?: string | null) => (campusId ? { student: { campusId } } : {})

/** Sessions today + sessions yesterday with no attendance (optionally only some groups). */
export async function sessionCounts(campusId?: string | null, groupIds?: string[]) {
  const p = periods()
  const groups = await occurrencesFor(groupIds ? { groupIds } : { campusId }, p.yesterday, p.todayKey)
  let today = 0
  let missingYesterday = 0
  for (const g of groups) for (const o of g.occurrences) {
    if (o.date === p.todayKey && ['SCHEDULED', 'HELD', 'NOT_STARTED'].includes(o.status)) today++
    if (o.date === p.yesterday && o.status === 'MISSING') missingYesterday++
  }
  return { today, missingYesterday }
}

async function overdue(campusId?: string | null) {
  const p = periods()
  const rows = await prisma.feeInvoice.findMany({
    where: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] }, dueDate: { lt: p.today }, ...studentFilter(campusId) },
    select: { totalAmount: true, paidAmount: true },
  })
  return { count: rows.length, amount: rows.reduce((a, r) => a + num(r.totalAmount) - num(r.paidAmount), 0) }
}

async function waitingItems(campusId?: string | null) {
  const [topups, proofs, excuses, withdrawals] = await Promise.all([
    prisma.walletTopUp.count({ where: { status: 'PENDING', ...studentFilter(campusId) } }),
    prisma.feeInvoice.count({ where: { proofStatus: 'PENDING', ...studentFilter(campusId) } }),
    prisma.absenceExcuse.count({ where: { status: 'PENDING', ...(campusId && { classSectionId: { in: (await prisma.classSection.findMany({ where: { campusId }, select: { id: true } })).map((g) => g.id) } }) } }),
    prisma.walletWithdrawal.count({ where: { status: 'PENDING', ...studentFilter(campusId) } }),
  ])
  return { topups, proofs, excuses, withdrawals }
}

export async function managerMetrics(campusId?: string | null): Promise<Metric[]> {
  const p = periods()
  const [payments, refunds, invoices, active, newStudents, renewals, od, prepaid, sessions, waiting] = await Promise.all([
    prisma.feePayment.aggregate({ where: { paymentDate: { gte: p.monthStart }, ...studentFilter(campusId) }, _sum: { amount: true } }),
    prisma.refund.aggregate({ where: { status: 'APPROVED', approvedAt: { gte: p.monthStart }, ...studentFilter(campusId) }, _sum: { amount: true } }),
    prisma.feeInvoice.aggregate({ where: { createdAt: { gte: p.monthStart }, status: { not: 'CANCELLED' }, ...studentFilter(campusId) }, _sum: { totalAmount: true, paidAmount: true } }),
    prisma.studentEnrollment.findMany({ where: { status: 'ACTIVE', classSection: { status: 'ACTIVE', levelId: { not: null }, ...(campusId && { campusId }) } }, select: { studentId: true }, distinct: ['studentId'] }),
    prisma.student.count({ where: { createdAt: { gte: p.monthStart }, ...(campusId && { campusId }) } }),
    prisma.renewalRequest.groupBy({ by: ['status'], where: { createdAt: { gte: new Date(Date.now() - 60 * 86_400_000) }, ...(campusId && { classSectionId: { in: (await prisma.classSection.findMany({ where: { campusId }, select: { id: true } })).map((g) => g.id) } }) }, _count: { _all: true } }),
    overdue(campusId),
    prepaidTotal(campusId),
    sessionCounts(campusId),
    waitingItems(campusId),
  ])
  const income = num(payments._sum.amount) - num(refunds._sum.amount)
  const invoiced = num(invoices._sum.totalAmount)
  const collected = num(invoices._sum.paidAmount)
  const yes = renewals.find((r) => r.status === 'YES')?._count._all ?? 0
  const no = renewals.find((r) => r.status === 'NO')?._count._all ?? 0
  const renewalPct = yes + no ? Math.round((yes / (yes + no)) * 100) : null
  const collectionPct = invoiced ? Math.round((collected / invoiced) * 100) : null
  const waitingTotal = waiting.topups + waiting.proofs + waiting.excuses + waiting.withdrawals
  return [
    { key: 'income', label: 'Income this month', value: money(income), hint: 'payments − approved refunds', href: '/dashboard/accountant/reports' },
    { key: 'collection', label: 'Collected of this month\'s invoices', value: collectionPct == null ? '—' : `${collectionPct}%`, hint: `${money(collected)} of ${money(invoiced)}`, tone: collectionPct == null ? undefined : collectionPct >= 80 ? 'good' : collectionPct >= 50 ? 'warn' : 'bad', href: '/dashboard/fees' },
    { key: 'students', label: 'Active students', value: active.length, hint: `${newStudents} new this month`, href: '/dashboard/students' },
    { key: 'renewal', label: 'Renewal (last 60 days)', value: renewalPct == null ? '—' : `${renewalPct}%`, hint: `${yes} continuing · ${no} not`, tone: renewalPct == null ? undefined : renewalPct >= 80 ? 'good' : renewalPct >= 60 ? 'warn' : 'bad', href: '/dashboard/renewals' },
    { key: 'overdue', label: 'Overdue invoices', value: od.count, hint: money(od.amount), tone: od.count ? 'warn' : 'good', href: '/dashboard/fees' },
    { key: 'prepaid', label: 'Prepaid in wallets', value: money(prepaid), href: '/dashboard/wallet' },
    { key: 'sessions', label: 'Sessions today', value: sessions.today, hint: sessions.missingYesterday ? `${sessions.missingYesterday} without attendance yesterday` : 'all of yesterday recorded', tone: sessions.missingYesterday ? 'warn' : 'good', href: '/dashboard/schedule' },
    { key: 'waiting', label: 'Waiting for you', value: waitingTotal, hint: `${waiting.proofs + waiting.topups} receipts · ${waiting.excuses} excuses · ${waiting.withdrawals} withdrawals`, tone: waitingTotal ? 'warn' : 'good' },
  ]
}

export async function accountantMetrics(campusId?: string | null): Promise<Metric[]> {
  const p = periods()
  const [todayPay, monthPay, od, prepaid, waiting] = await Promise.all([
    prisma.feePayment.aggregate({ where: { paymentDate: { gte: p.today }, ...studentFilter(campusId) }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.feePayment.aggregate({ where: { paymentDate: { gte: p.monthStart }, ...studentFilter(campusId) }, _sum: { amount: true } }),
    overdue(campusId),
    prepaidTotal(campusId),
    waitingItems(campusId),
  ])
  return [
    { key: 'today', label: 'Collected today', value: money(num(todayPay._sum.amount)), hint: `${todayPay._count._all} payments` },
    { key: 'month', label: 'Collected this month', value: money(num(monthPay._sum.amount)) },
    { key: 'overdue', label: 'Overdue invoices', value: od.count, hint: money(od.amount), tone: od.count ? 'warn' : 'good', href: '/dashboard/fees' },
    { key: 'receipts', label: 'Receipts to check', value: waiting.proofs + waiting.topups, tone: waiting.proofs + waiting.topups ? 'warn' : 'good', href: '/dashboard/wallet' },
    { key: 'withdrawals', label: 'Withdrawals waiting', value: waiting.withdrawals, tone: waiting.withdrawals ? 'warn' : 'good', href: '/dashboard/wallet' },
    { key: 'prepaid', label: 'Prepaid in wallets', value: money(prepaid), href: '/dashboard/wallet' },
  ]
}

export async function secretaryMetrics(campusId?: string | null): Promise<Metric[]> {
  const p = periods()
  const endOfToday = new Date(p.today.getTime() + 86_400_000)
  const [followUps, od, waiting, waitList, birthdays, sessions] = await Promise.all([
    prisma.contactLog.count({ where: { followUpAt: { lt: endOfToday }, followUpDoneAt: null, ...(campusId && { campusId }) } }),
    overdue(campusId),
    waitingItems(campusId),
    prisma.waitingListEntry.count({ where: { status: 'WAITING', ...(campusId && { campusId }) } }),
    birthdayPeople({ days: 0, kinds: ['STUDENT'], campusId }),
    sessionCounts(campusId),
  ])
  return [
    { key: 'followups', label: 'Parents to call today', value: followUps, tone: followUps ? 'warn' : 'good', href: '/dashboard/follow-ups' },
    { key: 'overdue', label: 'Overdue invoices', value: od.count, hint: money(od.amount), tone: od.count ? 'warn' : 'good', href: '/dashboard/fees' },
    { key: 'excuses', label: 'Excuses to review', value: waiting.excuses, tone: waiting.excuses ? 'warn' : 'good', href: '/dashboard/absence-excuses' },
    { key: 'waitlist', label: 'On the waiting list', value: waitList, href: '/dashboard/waiting-list' },
    { key: 'birthdays', label: 'Student birthdays today', value: birthdays.length, href: '/dashboard/birthdays' },
    { key: 'sessions', label: 'Sessions today', value: sessions.today, hint: sessions.missingYesterday ? `${sessions.missingYesterday} without attendance yesterday` : undefined, tone: sessions.missingYesterday ? 'warn' : undefined, href: '/dashboard/schedule' },
  ]
}

export async function teacherMetrics(teacherId: string, groupIds: string[]): Promise<Metric[]> {
  const since = new Date(Date.now() - 30 * 86_400_000)
  const [sessions, records] = await Promise.all([
    groupIds.length ? sessionCounts(null, groupIds) : Promise.resolve({ today: 0, missingYesterday: 0 }),
    prisma.enrollmentAttendanceRecord.groupBy({ by: ['status'], where: { attendanceDate: { gte: since }, studentEnrollment: { classSectionId: { in: groupIds } } }, _count: { _all: true } }),
  ])
  const c = (s: string) => records.find((r) => r.status === s)?._count._all ?? 0
  const total = c('PRESENT') + c('LATE') + c('ABSENT') + c('EXCUSED')
  const pct = total ? Math.round(((c('PRESENT') + c('LATE')) / total) * 100) : null
  void teacherId
  return [
    { key: 'sessions', label: 'Your sessions today', value: sessions.today, href: '/dashboard/schedule' },
    { key: 'missing', label: 'Attendance not recorded (yesterday)', value: sessions.missingYesterday, tone: sessions.missingYesterday ? 'bad' : 'good', href: '/dashboard/teacher/attendance' },
    { key: 'attendance', label: 'Attendance in your groups (30 days)', value: pct == null ? '—' : `${pct}%`, tone: pct == null ? undefined : pct >= 85 ? 'good' : pct >= 70 ? 'warn' : 'bad' },
    { key: 'groups', label: 'Your active groups', value: groupIds.length },
  ]
}
