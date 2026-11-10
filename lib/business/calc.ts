/**
 * Business growth (p14, owner 2026-11-10): the company's numbers month by month. PURE maths only, the engine
 * (./engine.ts) loads grouped rows from the database. Tests: tests/business-calc.test.ts.
 *
 * Words used here:
 * - active in a month   = had at least one attendance record (present or absent) in that month.
 * - new in a month      = their first attendance ever is in that month.
 * - stopped in a month  = their last attendance ever is in that month, the month is over, and they are not in a group now.
 * - continuation of M   = of the students active in M-1, the share still active in M (only for finished months).
 * - income              = payments received − refunds approved (the same rule as the P&L / month close).
 * - profit              = income − expenses − salaries (company only; never shown to a branch manager).
 */

export type Ym = string // 'YYYY-MM'

export function ymAdd(ym: Ym, n: number): Ym {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

/** The last `count` months ending with `last`, oldest first. */
export function monthList(last: Ym, count: number): Ym[] {
  return Array.from({ length: count }, (_, i) => ymAdd(last, i - count + 1))
}

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)
export const r2 = (n: number) => Math.round(n * 100) / 100

/** Change from `before` to `now` in %, null when there is nothing to compare with. */
export function change(now: number | null, before: number | null): number | null {
  if (now == null || before == null || before === 0) return null
  return Math.round(((now - before) / Math.abs(before)) * 1000) / 10
}

/** NPS from 0..10 answers: % promoters (9-10) − % detractors (0-6). */
export function nps(scores: number[]): number | null {
  const s = scores.filter((x) => Number.isFinite(x) && x >= 0 && x <= 10)
  if (!s.length) return null
  const pro = s.filter((x) => x >= 9).length, det = s.filter((x) => x <= 6).length
  return Math.round(((pro - det) / s.length) * 100)
}

/** One student, all time: first / last month with attendance, how many months, and whether they are in a group now. */
export interface StudentSpan { studentId: string; first: Ym; last: Ym; months: number; activeNow: boolean; netPaid: number }

export function newAndStopped(spans: StudentSpan[], months: Ym[], current: Ym) {
  const out = new Map(months.map((m) => [m, { new: 0, stopped: 0 }]))
  for (const s of spans) {
    out.get(s.first) && (out.get(s.first)!.new += 1)
    if (!s.activeNow && s.last < current) { const o = out.get(s.last); if (o) o.stopped += 1 }
  }
  return out
}

/** Continuation of each finished month: share of last month's active students still active this month. */
export function continuation(activeByMonth: Map<Ym, Set<string>>, months: Ym[], current: Ym): Map<Ym, number | null> {
  const out = new Map<Ym, number | null>()
  for (const m of months) {
    const prev = activeByMonth.get(ymAdd(m, -1)), now = activeByMonth.get(m)
    if (m >= current || !prev || !prev.size) { out.set(m, null); continue }
    let kept = 0
    for (const id of prev) if (now?.has(id)) kept += 1
    out.set(m, pct(kept, prev.size))
  }
  return out
}

/** Where students stop: how many months they stayed before stopping, in bands. And their average value. */
export const STAY_BANDS = [
  { key: '1', en: '1 month', ar: 'شهر واحد', min: 1, max: 1 },
  { key: '2', en: '2 months', ar: 'شهرين', min: 2, max: 2 },
  { key: '3', en: '3 months', ar: '3 شهور', min: 3, max: 3 },
  { key: '4-6', en: '4–6 months', ar: '4–6 شهور', min: 4, max: 6 },
  { key: '7-12', en: '7–12 months', ar: '7–12 شهر', min: 7, max: 12 },
  { key: '13+', en: 'More than a year', ar: 'أكتر من سنة', min: 13, max: Infinity },
] as const

export function stayAndValue(spans: StudentSpan[], current: Ym) {
  const stopped = spans.filter((s) => !s.activeNow && s.last < current)
  const bands = STAY_BANDS.map((b) => ({ key: b.key, en: b.en, ar: b.ar, count: stopped.filter((s) => s.months >= b.min && s.months <= b.max).length }))
  const worst = [...bands].sort((a, b) => b.count - a.count)[0]
  const avg = (xs: number[]) => (xs.length ? r2(xs.reduce((a, x) => a + x, 0) / xs.length) : null)
  return {
    stoppedCount: stopped.length,
    avgMonths: avg(stopped.map((s) => s.months)),
    avgValue: avg(stopped.map((s) => s.netPaid)), // what a student who left paid in all, on average
    avgValueAll: avg(spans.map((s) => s.netPaid)),
    bands,
    mostStopAt: worst && worst.count > 0 ? worst.key : null,
  }
}

export function ageBand(age: number) {
  if (age < 7) return '4-6'
  if (age < 10) return '7-9'
  if (age < 13) return '10-12'
  if (age < 16) return '13-15'
  if (age < 19) return '16-18'
  return '18+'
}

/** Targets: the metrics a manager can set for a month. `higherIsBetter` decides what "behind" means. */
export const TARGET_METRICS = [
  { key: 'income', en: 'Income (EGP)', ar: 'الدخل (جنيه)' },
  { key: 'newStudents', en: 'New students', ar: 'طلاب جداد' },
  { key: 'activeStudents', en: 'Active students', ar: 'طلاب نشطين' },
  { key: 'continuation', en: 'Continuation %', ar: 'نسبة الاستمرار %' },
  { key: 'attendance', en: 'Attendance %', ar: 'نسبة الحضور %' },
  { key: 'collection', en: 'Collection %', ar: 'نسبة التحصيل %' },
] as const
export type TargetMetric = (typeof TARGET_METRICS)[number]['key']
export const isTargetMetric = (k: string): k is TargetMetric => TARGET_METRICS.some((t) => t.key === k)

/**
 * How far a month is from its target. For a running month the counts (income, new students) are compared with the
 * part of the month gone; rates and the active count are compared as they are.
 */
export function targetState(metric: TargetMetric, actual: number | null, target: number, monthDone: number): { pct: number | null; state: 'AHEAD' | 'ON_TRACK' | 'BEHIND' | 'NONE' } {
  if (actual == null || !(target > 0)) return { pct: null, state: 'NONE' }
  const counts = metric === 'income' || metric === 'newStudents'
  const expected = counts ? target * Math.min(1, Math.max(0.05, monthDone)) : target
  const p = Math.round((actual / target) * 1000) / 10
  const ratio = actual / expected
  return { pct: p, state: ratio >= 1.05 ? 'AHEAD' : ratio >= 0.9 ? 'ON_TRACK' : 'BEHIND' }
}

export interface MonthRow {
  ym: Ym; income: number; refunds: number; expenses: number; salaries: number; profit: number | null
  active: number; newStudents: number; stopped: number; continuation: number | null
  attendancePct: number | null; sessions: number; cancelled: number
  invoiced: number; collected: number; collectionPct: number | null
  rating: number | null; ratings: number; complaints: number; nps: number | null
  requests: number; inquiries: number; referrals: number; lessonViews: number; activeUsers: number | null
  perStudent: number | null
}

export interface Attention { key: string; level: 'bad' | 'warn'; en: string; ar: string; href?: string }

/**
 * "Needs your attention": simple rules over the last finished month (and the running one for targets).
 * Each line says what is wrong in plain words.
 */
export function attention(i: {
  last: MonthRow | undefined; before: MonthRow | undefined; yearAgo: MonthRow | undefined
  overdue: number; fullWithWaiting: number; places: { name: string; income: number; incomeBefore: number; attendancePct: number | null }[]
  behind: { en: string; ar: string }[]
}): Attention[] {
  const out: Attention[] = []
  const L = i.last, B = i.before
  if (L?.continuation != null && L.continuation < 70) out.push({ key: 'continuation', level: 'bad', en: `Only ${L.continuation}% of students continued in ${L.ym}.`, ar: `${L.continuation}% بس من الطلاب كمّلوا في ${L.ym}.`, href: '/dashboard/renewals' })
  else if (L?.continuation != null && B?.continuation != null && B.continuation - L.continuation >= 10) out.push({ key: 'continuationDrop', level: 'warn', en: `Continuation fell from ${B.continuation}% to ${L.continuation}%.`, ar: `الاستمرار نزل من ${B.continuation}% لـ ${L.continuation}%.`, href: '/dashboard/renewals' })
  if (L?.attendancePct != null && L.attendancePct < 75) out.push({ key: 'attendance', level: 'warn', en: `Attendance was ${L.attendancePct}% in ${L.ym}.`, ar: `الحضور كان ${L.attendancePct}% في ${L.ym}.`, href: '/dashboard/reports/attendance' })
  if (L?.collectionPct != null && L.collectionPct < 80) out.push({ key: 'collection', level: 'warn', en: `Only ${L.collectionPct}% of ${L.ym}'s invoices are paid.`, ar: `${L.collectionPct}% بس من فواتير ${L.ym} اتدفعت.`, href: '/dashboard/fees' })
  if (i.overdue > 0 && L && i.overdue > L.income * 0.1) out.push({ key: 'overdue', level: 'bad', en: `${Math.round(i.overdue)} EGP of invoices are overdue.`, ar: `${Math.round(i.overdue)} جنيه فواتير متأخرة.`, href: '/dashboard/fees' })
  if (i.fullWithWaiting > 0) out.push({ key: 'capacity', level: 'warn', en: `${i.fullWithWaiting} full group(s) have a waiting list: open a new group?`, ar: `${i.fullWithWaiting} جروب مليان وعليه قايمة انتظار: نفتح جروب جديد؟`, href: '/dashboard/waiting-list' })
  if (L?.rating != null && L.ratings >= 5 && L.rating < 3.5) out.push({ key: 'rating', level: 'warn', en: `Session rating average was ${L.rating} / 5.`, ar: `متوسط تقييم الحصص ${L.rating} من 5.`, href: '/dashboard/ratings' })
  if (L && B && L.complaints > B.complaints && L.complaints >= 3) out.push({ key: 'complaints', level: 'warn', en: `Complaints went up: ${B.complaints} → ${L.complaints}.`, ar: `الشكاوى زادت: ${B.complaints} ← ${L.complaints}.`, href: '/dashboard/complaints' })
  const yoy = change(L?.newStudents ?? null, i.yearAgo?.newStudents ?? null)
  if (yoy != null && yoy <= -20) out.push({ key: 'newYoy', level: 'warn', en: `New students are ${Math.abs(yoy)}% fewer than the same month last year.`, ar: `الطلاب الجداد أقل ${Math.abs(yoy)}% من نفس الشهر السنة اللي فاتت.` })
  for (const p of i.places) {
    const c = change(p.income, p.incomeBefore)
    if (c != null && c <= -20 && p.incomeBefore >= 1000) out.push({ key: `placeIncome:${p.name}`, level: 'warn', en: `${p.name}: income fell ${Math.abs(c)}%.`, ar: `${p.name}: الدخل نزل ${Math.abs(c)}%.` })
    if (p.attendancePct != null && p.attendancePct < 70) out.push({ key: `placeAtt:${p.name}`, level: 'warn', en: `${p.name}: attendance ${p.attendancePct}%.`, ar: `${p.name}: الحضور ${p.attendancePct}%.` })
  }
  for (const b of i.behind) out.push({ key: `target:${b.en}`, level: 'warn', en: `Behind the target: ${b.en}.`, ar: `متأخرين عن الهدف: ${b.ar}.` })
  return out
}
