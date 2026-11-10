/**
 * Business growth (p14, 2026-11-10): loads grouped rows (24 months, so a month can be compared with the same month
 * last year) and builds the screen with the pure rules in ./calc.ts. Server only.
 *
 * Who: RBAC `business_growth` (Super Admin, Admin; branch manager = his places only, never company profit / salaries).
 * Places: rows follow the group's place (else the student's place), the same rule as invoices (`invoiceWhere`).
 * Months: payments / refunds / complaints use Cairo months (UTC+2); attendance dates are plain dates.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import type { Places } from '@/lib/places/server'
import { cairoToday, ageOn, cairoYmd } from '@/lib/dates/cairo'
import {
  ageBand, attention, change, continuation, monthList, newAndStopped, nps, pct, r2, stayAndValue, targetState, ymAdd,
  TARGET_METRICS, type MonthRow, type StudentSpan, type TargetMetric, type Ym,
} from './calc'

const num = (v: unknown) => Number(v ?? 0)
const CAIRO = (col: Prisma.Sql) => Prisma.sql`DATE_FORMAT(CONVERT_TZ(${col}, '+00:00', '+02:00'), '%Y-%m')`

export const canSeeBusiness = (role: string) => checkPermission(role, 'business_growth', 'read')
/** Company profit, salaries and the company-wide usage numbers: only for people who see every place (and not a branch manager). */
export const seesCompanyMoney = (role: string, p: Places) => p.all && role !== 'BRANCH_MANAGER'

/** SQL piece limiting a place column (nothing when every place is allowed). */
function inPlaces(p: Places, col: Prisma.Sql) {
  if (p.all) return Prisma.empty
  if (!p.campusIds.length) return Prisma.sql` AND 1 = 0`
  return Prisma.sql` AND ${col} IN (${Prisma.join(p.campusIds)})`
}

type Dim = 'campus' | 'track' | 'course' | 'level' | 'teacher' | 'partner'
interface GroupInfo { campusId: string; campus: string; partner: string | null; levelId: string | null; level: string | null; courseId: string | null; course: string | null; trackId: string | null; track: string | null; teacherId: string | null; teacher: string | null }

async function groupInfo(): Promise<Map<string, GroupInfo>> {
  const rows = await prisma.classSection.findMany({
    select: {
      id: true, campusId: true, levelId: true,
      campus: { select: { name: true, partner: { select: { name: true } } } },
      subjectOfferings: { where: { teacherId: { not: null } }, orderBy: { createdAt: 'desc' }, take: 1, select: { teacher: { select: { id: true, firstName: true, lastName: true } } } },
    },
  })
  const levelIds = [...new Set(rows.map((r) => r.levelId).filter(Boolean) as string[])]
  const levels = await prisma.level.findMany({ where: { id: { in: levelIds } }, select: { id: true, name: true, subject: { select: { id: true, name: true, track: { select: { id: true, name: true } } } } } })
  const lv = new Map(levels.map((l) => [l.id, l]))
  return new Map(rows.map((r) => {
    const l = r.levelId ? lv.get(r.levelId) : undefined
    const t = r.subjectOfferings[0]?.teacher
    return [r.id, {
      campusId: r.campusId, campus: r.campus.name, partner: r.campus.partner?.name ?? null,
      levelId: l?.id ?? null, level: l ? `${l.subject.name} · ${l.name}` : null, courseId: l?.subject.id ?? null, course: l?.subject.name ?? null,
      trackId: l?.subject.track?.id ?? null, track: l?.subject.track?.name ?? null,
      teacherId: t?.id ?? null, teacher: t ? `${t.firstName} ${t.lastName}`.trim() : null,
    }]
  }))
}

function dimOf(g: GroupInfo | undefined, d: Dim): { id: string; name: string } | null {
  if (!g) return null
  switch (d) {
    case 'campus': return { id: g.campusId, name: g.campus }
    case 'partner': return g.partner ? { id: g.partner, name: g.partner } : null
    case 'track': return g.trackId ? { id: g.trackId, name: g.track! } : null
    case 'course': return g.courseId ? { id: g.courseId, name: g.course! } : null
    case 'level': return g.levelId ? { id: g.levelId, name: g.level! } : null
    case 'teacher': return g.teacherId ? { id: g.teacherId, name: g.teacher! } : null
  }
}

export interface GrowthOptions { months?: number; scopeKey?: string }

export async function businessGrowth(user: { id: string; role: string }, places: Places, opts: GrowthOptions = {}) {
  const months = Math.min(24, Math.max(3, opts.months ?? 12))
  const today = cairoToday()
  const current: Ym = today.slice(0, 7)
  const shown = monthList(current, months)
  const all24 = monthList(current, Math.max(24, months + 12))
  const from = `${all24[0]}-01`
  const fromDt = new Date(`${from}T00:00:00.000Z`)
  const companyMoney = seesCompanyMoney(user.role, places)
  const gPlace = Prisma.sql`COALESCE(c.campusId, s.campusId)`

  // ── attendance per student · group · month (window) and all-time spans ──
  const att = await prisma.$queryRaw<{ studentId: string; g: string; ym: string; n: bigint; p: bigint }[]>`
    SELECT e.studentId, e.classSectionId AS g, DATE_FORMAT(r.attendanceDate, '%Y-%m') AS ym, COUNT(*) AS n, SUM(r.status IN ('PRESENT','LATE')) AS p
    FROM EnrollmentAttendanceRecord r JOIN StudentEnrollment e ON e.id = r.studentEnrollmentId JOIN ClassSection c ON c.id = e.classSectionId JOIN Student s ON s.id = e.studentId
    WHERE r.attendanceDate >= ${fromDt} ${inPlaces(places, gPlace)}
    GROUP BY e.studentId, e.classSectionId, ym`
  const spansRaw = await prisma.$queryRaw<{ studentId: string; first: string; last: string; months: bigint }[]>`
    SELECT e.studentId, DATE_FORMAT(MIN(r.attendanceDate), '%Y-%m') AS first, DATE_FORMAT(MAX(r.attendanceDate), '%Y-%m') AS last, COUNT(DISTINCT DATE_FORMAT(r.attendanceDate, '%Y-%m')) AS months
    FROM EnrollmentAttendanceRecord r JOIN StudentEnrollment e ON e.id = r.studentEnrollmentId JOIN ClassSection c ON c.id = e.classSectionId JOIN Student s ON s.id = e.studentId
    WHERE 1 = 1 ${inPlaces(places, gPlace)}
    GROUP BY e.studentId`
  const activeNowRows = await prisma.studentEnrollment.findMany({ where: { status: 'ACTIVE', ...(places.all ? {} : { classSection: { campusId: { in: places.campusIds } } }) }, select: { studentId: true, classSectionId: true } })
  const activeNow = new Set(activeNowRows.map((r) => r.studentId))

  // ── money ──
  const pay = await prisma.$queryRaw<{ studentId: string; g: string | null; ym: string; amt: number }[]>`
    SELECT p.studentId, i.classSectionId AS g, ${CAIRO(Prisma.sql`p.paymentDate`)} AS ym, SUM(p.amount) AS amt
    FROM FeePayment p JOIN FeeInvoice i ON i.id = p.invoiceId LEFT JOIN ClassSection c ON c.id = i.classSectionId JOIN Student s ON s.id = p.studentId
    WHERE p.status = 'COMPLETED' AND p.paymentDate >= ${fromDt} ${inPlaces(places, gPlace)}
    GROUP BY p.studentId, i.classSectionId, ym`
  const ref = await prisma.$queryRaw<{ studentId: string; g: string | null; ym: string; amt: number }[]>`
    SELECT f.studentId, i.classSectionId AS g, ${CAIRO(Prisma.sql`f.approvedAt`)} AS ym, SUM(f.amount) AS amt
    FROM Refund f JOIN FeeInvoice i ON i.id = f.invoiceId LEFT JOIN ClassSection c ON c.id = i.classSectionId JOIN Student s ON s.id = f.studentId
    WHERE f.status = 'APPROVED' AND f.approvedAt >= ${fromDt} ${inPlaces(places, gPlace)}
    GROUP BY f.studentId, i.classSectionId, ym`
  const lifetime = await prisma.$queryRaw<{ studentId: string; paid: number }[]>`
    SELECT p.studentId, SUM(p.amount) AS paid FROM FeePayment p JOIN FeeInvoice i ON i.id = p.invoiceId LEFT JOIN ClassSection c ON c.id = i.classSectionId JOIN Student s ON s.id = p.studentId
    WHERE p.status = 'COMPLETED' ${inPlaces(places, gPlace)} GROUP BY p.studentId`
  const lifetimeRef = await prisma.$queryRaw<{ studentId: string; amt: number }[]>`
    SELECT f.studentId, SUM(f.amount) AS amt FROM Refund f JOIN FeeInvoice i ON i.id = f.invoiceId LEFT JOIN ClassSection c ON c.id = i.classSectionId JOIN Student s ON s.id = f.studentId
    WHERE f.status = 'APPROVED' ${inPlaces(places, gPlace)} GROUP BY f.studentId`
  const inv = await prisma.$queryRaw<{ g: string | null; ym: string; total: number; paid: number; refunded: number }[]>`
    SELECT i.classSectionId AS g, ${CAIRO(Prisma.sql`i.createdAt`)} AS ym, SUM(i.totalAmount) AS total, SUM(i.paidAmount) AS paid, SUM(i.refundedAmount) AS refunded
    FROM FeeInvoice i LEFT JOIN ClassSection c ON c.id = i.classSectionId JOIN Student s ON s.id = i.studentId
    WHERE i.createdAt >= ${fromDt} AND i.status <> 'CANCELLED' ${inPlaces(places, gPlace)}
    GROUP BY i.classSectionId, ym`
  const exp = await prisma.$queryRaw<{ campusId: string; ym: string; cat: string; amt: number }[]>`
    SELECT x.campusId, DATE_FORMAT(x.date, '%Y-%m') AS ym, COALESCE(d.key, x.category) AS cat, SUM(x.amount) AS amt
    FROM Expense x LEFT JOIN ExpenseCategoryDef d ON d.id = x.categoryId
    WHERE x.isDeleted = 0 AND x.isApproved = 1 AND x.date >= ${fromDt} ${inPlaces(places, Prisma.sql`x.campusId`)}
    GROUP BY x.campusId, ym, cat`
  const sal = companyMoney ? await prisma.$queryRaw<{ ym: string; amt: number }[]>`
    SELECT DATE_FORMAT(salaryPeriodStart, '%Y-%m') AS ym, SUM(netSalary) AS amt FROM SalarySlip
    WHERE isDeleted = 0 AND status <> 'CANCELLED' AND approvalStatus <> 'REJECTED' AND salaryPeriodStart >= ${fromDt}
    GROUP BY ym` : []

  // ── sessions, quality, marketing ──
  const held = await prisma.$queryRaw<{ g: string; ym: string; n: bigint }[]>`
    SELECT t.g, t.ym, COUNT(*) AS n FROM (
      SELECT DISTINCT e.classSectionId AS g, r.attendanceDate AS d, DATE_FORMAT(r.attendanceDate, '%Y-%m') AS ym
      FROM EnrollmentAttendanceRecord r JOIN StudentEnrollment e ON e.id = r.studentEnrollmentId JOIN ClassSection c ON c.id = e.classSectionId
      WHERE r.attendanceDate >= ${fromDt} ${inPlaces(places, Prisma.sql`c.campusId`)}
      UNION
      SELECT l.classSectionId AS g, l.sessionDate AS d, DATE_FORMAT(l.sessionDate, '%Y-%m') AS ym FROM GroupSessionLog l JOIN ClassSection c ON c.id = l.classSectionId
      WHERE l.status = 'HELD' AND l.sessionDate >= ${fromDt} ${inPlaces(places, Prisma.sql`c.campusId`)}
    ) t GROUP BY t.g, t.ym`
  const cancelled = await prisma.$queryRaw<{ ym: string; n: bigint }[]>`
    SELECT DATE_FORMAT(x.date, '%Y-%m') AS ym, COUNT(*) AS n FROM CancelledSession x JOIN ClassSection c ON c.id = x.classSectionId
    WHERE x.date >= ${fromDt} ${inPlaces(places, Prisma.sql`c.campusId`)} GROUP BY ym`
  const ratings = await prisma.$queryRaw<{ g: string; ym: string; n: bigint; total: number }[]>`
    SELECT f.classSectionId AS g, DATE_FORMAT(f.sessionDate, '%Y-%m') AS ym, COUNT(*) AS n, SUM(f.rating) AS total FROM SessionFeedback f JOIN ClassSection c ON c.id = f.classSectionId
    WHERE f.sessionDate >= ${fromDt} ${inPlaces(places, Prisma.sql`c.campusId`)} GROUP BY f.classSectionId, ym`
  const surveys = await prisma.$queryRaw<{ ym: string; recommend: number }[]>`
    SELECT ${CAIRO(Prisma.sql`v.createdAt`)} AS ym, v.recommend FROM ParentSurvey v JOIN ClassSection c ON c.id = v.classSectionId
    WHERE v.recommend IS NOT NULL AND v.createdAt >= ${fromDt} ${inPlaces(places, Prisma.sql`c.campusId`)}`
  const complaints = await prisma.$queryRaw<{ ym: string; n: bigint }[]>`
    SELECT ${CAIRO(Prisma.sql`createdAt`)} AS ym, COUNT(*) AS n FROM Complaint WHERE createdAt >= ${fromDt} ${places.all ? Prisma.empty : inPlaces(places, Prisma.sql`campusId`)} GROUP BY ym`
  const requests = await prisma.$queryRaw<{ ym: string; n: bigint; approved: bigint }[]>`
    SELECT ${CAIRO(Prisma.sql`createdAt`)} AS ym, COUNT(*) AS n, SUM(status = 'APPROVED') AS approved FROM AdmissionRequest
    WHERE createdAt >= ${fromDt} ${places.all ? Prisma.empty : inPlaces(places, Prisma.sql`preferredCampusId`)} GROUP BY ym`
  const inquiries = places.all ? await prisma.$queryRaw<{ ym: string; n: bigint }[]>`
    SELECT ${CAIRO(Prisma.sql`createdAt`)} AS ym, COUNT(*) AS n FROM LandingInquiry WHERE createdAt >= ${fromDt} GROUP BY ym` : []
  const referrals = await prisma.$queryRaw<{ ym: string; n: bigint; rewarded: bigint }[]>`
    SELECT ${CAIRO(Prisma.sql`r.createdAt`)} AS ym, COUNT(*) AS n, SUM(r.status = 'REWARDED') AS rewarded FROM Referral r JOIN Student s ON s.id = r.referredStudentId
    WHERE r.createdAt >= ${fromDt} ${inPlaces(places, Prisma.sql`s.campusId`)} GROUP BY ym`
  const views = await prisma.$queryRaw<{ ym: string; n: bigint }[]>`
    SELECT ${CAIRO(Prisma.sql`v.createdAt`)} AS ym, COUNT(*) AS n FROM LessonView v LEFT JOIN ClassSection c ON c.id = v.classSectionId
    WHERE v.createdAt >= ${fromDt} ${places.all ? Prisma.empty : inPlaces(places, Prisma.sql`c.campusId`)} GROUP BY ym`
  const usage = companyMoney ? await prisma.$queryRaw<{ ym: string; role: string | null; n: bigint }[]>`
    SELECT DATE_FORMAT(day, '%Y-%m') AS ym, role, COUNT(DISTINCT userId) AS n FROM UserActivityDay WHERE day >= ${fromDt} GROUP BY ym, role` : []

  const groups = await groupInfo()

  // ── month rows ──
  const blank = (ym: Ym): MonthRow => ({ ym, income: 0, refunds: 0, expenses: 0, salaries: 0, profit: null, active: 0, newStudents: 0, stopped: 0, continuation: null, attendancePct: null, sessions: 0, cancelled: 0, invoiced: 0, collected: 0, collectionPct: null, rating: null, ratings: 0, complaints: 0, nps: null, requests: 0, inquiries: 0, referrals: 0, lessonViews: 0, activeUsers: null, perStudent: null })
  const rows = new Map(all24.map((m) => [m, blank(m)]))
  const activeBy = new Map<Ym, Set<string>>(all24.map((m) => [m, new Set<string>()]))
  const attBy = new Map<Ym, { n: number; p: number }>()
  for (const a of att) {
    activeBy.get(a.ym)?.add(a.studentId)
    const t = attBy.get(a.ym) ?? { n: 0, p: 0 }; t.n += num(a.n); t.p += num(a.p); attBy.set(a.ym, t)
  }
  for (const p of pay) { const r = rows.get(p.ym); if (r) r.income += num(p.amt) }
  for (const p of ref) { const r = rows.get(p.ym); if (r) r.refunds += num(p.amt) }
  for (const x of exp) { const r = rows.get(x.ym); if (r) r.expenses += num(x.amt) }
  for (const x of sal) { const r = rows.get(x.ym); if (r) r.salaries += num(x.amt) }
  for (const x of inv) { const r = rows.get(x.ym); if (r) { r.invoiced += num(x.total); r.collected += num(x.paid) - num(x.refunded) } }
  for (const x of held) { const r = rows.get(x.ym); if (r) r.sessions += num(x.n) }
  for (const x of cancelled) { const r = rows.get(x.ym); if (r) r.cancelled += num(x.n) }
  const rt = new Map<Ym, { n: number; t: number }>()
  for (const x of ratings) { const t = rt.get(x.ym) ?? { n: 0, t: 0 }; t.n += num(x.n); t.t += num(x.total); rt.set(x.ym, t) }
  const npsBy = new Map<Ym, number[]>()
  for (const x of surveys) npsBy.set(x.ym, [...(npsBy.get(x.ym) ?? []), num(x.recommend)])
  for (const x of complaints) { const r = rows.get(x.ym); if (r) r.complaints = num(x.n) }
  for (const x of requests) { const r = rows.get(x.ym); if (r) r.requests = num(x.n) }
  for (const x of inquiries) { const r = rows.get(x.ym); if (r) r.inquiries = num(x.n) }
  for (const x of referrals) { const r = rows.get(x.ym); if (r) r.referrals = num(x.n) }
  for (const x of views) { const r = rows.get(x.ym); if (r) r.lessonViews = num(x.n) }
  const usageBy = new Map<Ym, number>()
  for (const x of usage) usageBy.set(x.ym, (usageBy.get(x.ym) ?? 0) + num(x.n))

  const paidBy = new Map(lifetime.map((x) => [x.studentId, num(x.paid)]))
  for (const x of lifetimeRef) paidBy.set(x.studentId, (paidBy.get(x.studentId) ?? 0) - num(x.amt))
  const spans: StudentSpan[] = spansRaw.map((s) => ({ studentId: s.studentId, first: s.first, last: s.last, months: num(s.months), activeNow: activeNow.has(s.studentId), netPaid: r2(paidBy.get(s.studentId) ?? 0) }))
  const ns = newAndStopped(spans, all24, current)
  const cont = continuation(activeBy, all24, current)

  for (const r of rows.values()) {
    r.active = activeBy.get(r.ym)?.size ?? 0
    r.newStudents = ns.get(r.ym)?.new ?? 0
    r.stopped = ns.get(r.ym)?.stopped ?? 0
    r.continuation = cont.get(r.ym) ?? null
    const a = attBy.get(r.ym); r.attendancePct = a ? pct(a.p, a.n) : null
    r.collectionPct = pct(r.collected, r.invoiced)
    const t = rt.get(r.ym); r.ratings = t?.n ?? 0; r.rating = t?.n ? r2(t.t / t.n) : null
    r.nps = nps(npsBy.get(r.ym) ?? [])
    const net = r.income - r.refunds
    r.perStudent = r.active ? r2(net / r.active) : null
    r.activeUsers = companyMoney ? usageBy.get(r.ym) ?? 0 : null
    if (companyMoney) r.profit = r2(net - r.expenses - r.salaries)
    else { r.salaries = 0; r.profit = null }
    r.income = r2(r.income); r.refunds = r2(r.refunds); r.expenses = r2(r.expenses); r.invoiced = r2(r.invoiced); r.collected = r2(r.collected)
  }
  const monthRows = shown.map((m) => rows.get(m)!)

  // ── comparisons (last finished month and the one before, per place / track / course / level / instructor / partner) ──
  const lastDone = ymAdd(current, -1), beforeDone = ymAdd(current, -2)
  function compare(d: Dim, lastDone: Ym, beforeDone: Ym) {
    type Acc = { id: string; name: string; active: Set<string>; prev: Set<string>; n: number; p: number; income: number; incomeBefore: number; rN: number; rT: number }
    const acc = new Map<string, Acc>()
    const get = (k: { id: string; name: string }) => { let a = acc.get(k.id); if (!a) { a = { id: k.id, name: k.name, active: new Set(), prev: new Set(), n: 0, p: 0, income: 0, incomeBefore: 0, rN: 0, rT: 0 }; acc.set(k.id, a) } return a }
    for (const a of att) {
      const k = dimOf(groups.get(a.g), d); if (!k) continue
      if (a.ym === lastDone) { const x = get(k); x.active.add(a.studentId); x.n += num(a.n); x.p += num(a.p) }
      if (a.ym === beforeDone) get(k).prev.add(a.studentId)
    }
    for (const p of pay) {
      const k = p.g ? dimOf(groups.get(p.g), d) : null; if (!k) continue
      if (p.ym === lastDone) get(k).income += num(p.amt)
      if (p.ym === beforeDone) get(k).incomeBefore += num(p.amt)
    }
    for (const p of ref) {
      const k = p.g ? dimOf(groups.get(p.g), d) : null; if (!k) continue
      if (p.ym === lastDone) get(k).income -= num(p.amt)
      if (p.ym === beforeDone) get(k).incomeBefore -= num(p.amt)
    }
    for (const x of ratings) { if (x.ym !== lastDone) continue; const k = dimOf(groups.get(x.g), d); if (!k) continue; const a = get(k); a.rN += num(x.n); a.rT += num(x.total) }
    return [...acc.values()].map((a) => {
      let kept = 0; for (const id of a.prev) if (a.active.has(id)) kept += 1
      return { id: a.id, name: a.name, active: a.active.size, income: r2(a.income), incomeChange: change(a.income, a.incomeBefore), incomeBefore: r2(a.incomeBefore), attendancePct: pct(a.p, a.n), continuation: pct(kept, a.prev.size), rating: a.rN ? r2(a.rT / a.rN) : null }
    }).sort((x, y) => y.income - x.income || y.active - x.active)
  }
  const compareAll = (m: Ym) => ({ month: m, campus: compare('campus', m, ymAdd(m, -1)), track: compare('track', m, ymAdd(m, -1)), course: compare('course', m, ymAdd(m, -1)), level: compare('level', m, ymAdd(m, -1)), teacher: compare('teacher', m, ymAdd(m, -1)), partner: compare('partner', m, ymAdd(m, -1)) })
  const comparisons = compareAll(lastDone)
  const comparisonsNow = compareAll(current)

  // ── capacity + waiting list (now) ──
  const activeGroups = await prisma.classSection.findMany({
    where: { status: 'ACTIVE', isActive: true, kind: { notIn: ['RECORDED'] }, ...(places.all ? {} : { campusId: { in: places.campusIds } }) },
    select: { id: true, className: true, maxStudents: true, levelId: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
  })
  const waiting = await prisma.waitingListEntry.groupBy({ by: ['levelId'], where: { status: 'WAITING', ...(places.all ? {} : { campusId: { in: places.campusIds } }) }, _count: { _all: true } })
  const waitingBy = new Map(waiting.map((w) => [w.levelId ?? '', w._count._all]))
  const limited = activeGroups.filter((g) => g.maxStudents)
  const seats = limited.reduce((a, g) => a + (g.maxStudents ?? 0), 0), filled = limited.reduce((a, g) => a + Math.min(g._count.enrollments, g.maxStudents ?? 0), 0)
  const full = limited.filter((g) => g._count.enrollments >= (g.maxStudents ?? 0))
  const fullWithWaiting = full.filter((g) => g.levelId && (waitingBy.get(g.levelId) ?? 0) > 0).length
  const capacity = {
    groups: activeGroups.length, limitedGroups: limited.length, seats, filled, fillPct: pct(filled, seats), fullGroups: full.length, fullWithWaiting,
    waiting: waiting.reduce((a, w) => a + w._count._all, 0),
    waitingByLevel: waiting.filter((w) => w.levelId).map((w) => ({ level: groups.size ? [...groups.values()].find((g) => g.levelId === w.levelId)?.level ?? w.levelId! : w.levelId!, count: w._count._all })).sort((a, b) => b.count - a.count).slice(0, 8),
    avgPerGroup: activeGroups.length ? r2(activeGroups.reduce((a, g) => a + g._count.enrollments, 0) / activeGroups.length) : null,
  }

  // ── who the students are (active now) ──
  const people = await prisma.student.findMany({ where: { id: { in: [...activeNow] } }, select: { dateOfBirth: true, gender: true, city: true, sourceOfInfo: true } })
  const tally = (xs: (string | null | undefined)[]) => { const m = new Map<string, number>(); for (const x of xs) { const k = (x ?? '').trim() || '—'; m.set(k, (m.get(k) ?? 0) + 1) } return [...m.entries()].map(([k, n]) => ({ key: k, count: n })).sort((a, b) => b.count - a.count) }
  const day = cairoYmd()
  const demographics = {
    total: people.length,
    ages: tally(people.map((p) => ageBand(ageOn(p.dateOfBirth, day)))).sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true })),
    gender: tally(people.map((p) => p.gender)),
    cities: tally(people.map((p) => p.city)).slice(0, 6),
  }
  // where new students came from (the last 12 months)
  const newIds = spans.filter((s) => s.first >= ymAdd(current, -11)).map((s) => s.studentId)
  const sources = tally((await prisma.student.findMany({ where: { id: { in: newIds } }, select: { sourceOfInfo: true } })).map((s) => s.sourceOfInfo)).slice(0, 8)

  // ── staff ──
  const teacherIds = new Set<string>()
  for (const r of activeNowRows) { const t = groups.get(r.classSectionId)?.teacherId; if (t) teacherIds.add(t) }
  const staff = { instructorsTeaching: teacherIds.size, studentsPerInstructor: teacherIds.size ? r2(activeNow.size / teacherIds.size) : null }

  // ── money health (now) ──
  const todayDt = new Date(`${today}T00:00:00.000Z`)
  const overdueRows = await prisma.$queryRaw<{ amt: number }[]>`
    SELECT SUM(GREATEST(0, i.totalAmount - i.paidAmount)) AS amt FROM FeeInvoice i LEFT JOIN ClassSection c ON c.id = i.classSectionId JOIN Student s ON s.id = i.studentId
    WHERE i.status IN ('ISSUED','PARTIALLY_PAID','OVERDUE') AND i.dueDate < ${todayDt} ${inPlaces(places, gPlace)}`
  const overdue = r2(num(overdueRows[0]?.amt))

  // ── marketing cost per new student (expense categories that look like marketing) ──
  const isMarketing = (k: string) => /MARKET|ADVERT|ADS|PROMO/i.test(k)
  const marketingSpend12 = r2(exp.filter((x) => x.ym >= ymAdd(current, -11) && isMarketing(x.cat)).reduce((a, x) => a + num(x.amt), 0))
  const new12 = newIds.length
  const marketing = { spend12: marketingSpend12, new12, costPerNew: new12 && marketingSpend12 ? r2(marketingSpend12 / new12) : null, sources }

  // ── same month every year (seasonality) ──
  const seasonality = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0')
    const thisYear = `${current.slice(0, 4)}-${mm}`, lastYear = `${Number(current.slice(0, 4)) - 1}-${mm}`
    return { month: mm, newThisYear: rows.get(thisYear)?.newStudents ?? null, newLastYear: rows.get(lastYear)?.newStudents ?? null, incomeThisYear: rows.get(thisYear) ? r2((rows.get(thisYear)!.income - rows.get(thisYear)!.refunds)) : null, incomeLastYear: rows.get(lastYear) ? r2(rows.get(lastYear)!.income - rows.get(lastYear)!.refunds) : null }
  })

  // ── targets ──
  const scopeKey = opts.scopeKey ?? (places.all ? 'ALL' : places.campusIds.length === 1 ? places.campusIds[0] : 'ALL')
  const targetRows = await prisma.businessTarget.findMany({ where: { ym: { in: [current, lastDone] }, scopeKey } })
  const dayNo = Number(today.slice(8, 10)), daysIn = new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5, 7)), 0)).getUTCDate()
  const actualOf = (r: MonthRow, k: TargetMetric): number | null => ({ income: r2(r.income - r.refunds), newStudents: r.newStudents, activeStudents: r.active, continuation: r.continuation, attendance: r.attendancePct, collection: r.collectionPct })[k]
  const targets = [current, lastDone].map((ym) => ({
    ym,
    items: TARGET_METRICS.map((m) => {
      const t = targetRows.find((x) => x.ym === ym && x.metric === m.key)
      const actual = actualOf(rows.get(ym)!, m.key)
      const st = t ? targetState(m.key, actual, t.value, ym === current ? dayNo / daysIn : 1) : { pct: null, state: 'NONE' as const }
      return { metric: m.key, en: m.en, ar: m.ar, target: t?.value ?? null, actual, ...st }
    }),
  }))
  const behind = targets[0].items.filter((i) => i.state === 'BEHIND').map((i) => ({ en: i.en, ar: i.ar }))

  const L = rows.get(lastDone), B = rows.get(beforeDone), Y = rows.get(ymAdd(lastDone, -12))
  const needs = attention({
    last: L, before: B, yearAgo: Y, overdue, fullWithWaiting,
    places: comparisons.campus.map((c) => ({ name: c.name, income: c.income, incomeBefore: c.incomeBefore, attendancePct: c.attendancePct })),
    behind,
  })

  const headline = (() => {
    const now = rows.get(current)!, prev = rows.get(lastDone)!, ya = rows.get(ymAdd(current, -12))
    const k = (en: string, ar: string, a: number | null, b: number | null, c: number | null, money = false) => ({ en, ar, now: a, prev: b, vsPrev: change(a, b), vsYear: change(a, c), money })
    const net = (r?: MonthRow) => (r ? r2(r.income - r.refunds) : null)
    return [
      k('Income', 'الدخل', net(now), net(prev), net(ya), true),
      k('Active students', 'طلاب نشطين', now.active, prev.active, ya?.active ?? null),
      k('New students', 'طلاب جداد', now.newStudents, prev.newStudents, ya?.newStudents ?? null),
      k('Continuation % (last month)', 'الاستمرار % (الشهر اللي فات)', prev.continuation, B?.continuation ?? null, Y?.continuation ?? null),
      k('Attendance %', 'الحضور %', now.attendancePct, prev.attendancePct, ya?.attendancePct ?? null),
      k('Collection %', 'التحصيل %', now.collectionPct, prev.collectionPct, ya?.collectionPct ?? null),
      ...(companyMoney ? [k('Profit', 'الربح', now.profit, prev.profit, ya?.profit ?? null, true)] : []),
    ]
  })()

  return {
    current, lastDone, months: shown, companyMoney, scopeKey,
    headline, monthRows, comparisons, comparisonsNow, capacity, demographics, staff, overdue, marketing,
    value: stayAndValue(spans, current), seasonality, targets, attention: needs,
  }
}

export type BusinessGrowth = Awaited<ReturnType<typeof businessGrowth>>

export async function saveTargets(userId: string, ym: string, scopeKey: string, values: Partial<Record<TargetMetric, number | null>>) {
  for (const m of TARGET_METRICS) {
    if (!(m.key in values)) continue
    const v = values[m.key]
    if (v == null || !Number.isFinite(v) || v <= 0) await prisma.businessTarget.deleteMany({ where: { ym, scopeKey, metric: m.key } })
    else await prisma.businessTarget.upsert({ where: { ym_scopeKey_metric: { ym, scopeKey, metric: m.key } }, create: { ym, scopeKey, metric: m.key, value: v, updatedById: userId }, update: { value: v, updatedById: userId } })
  }
}
