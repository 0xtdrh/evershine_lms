/**
 * LMS analytics — pure maths (no database). Used by lib/lms/analytics.ts; every scenario is in tests/lms-analytics.test.ts.
 * Owner 2026-10-11: numbers per period, groups table, students who need follow-up, hardest questions, weekly activity.
 */

import { quizScore, type SCORING } from '@/lib/quizzes/rules'

const DAY = 86_400_000
export const INACTIVE_DAYS = 14
/** a group is shown red when one of its numbers is below these */
export const WEAK = { openPct: 40, onTimePct: 50, quizAvg: 50, homeworkAvg: 50 }

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null)
const round1 = (x: number) => Math.round(x * 10) / 10
export const inRange = (d: Date | null | undefined, from: Date, to: Date) => !!d && d.getTime() >= from.getTime() && d.getTime() <= to.getTime()

export interface DueItem { blockId: string; dueAt: Date }
export interface SubRow { blockId: string; studentId: string; status: string; late: boolean; submittedAt: Date | null; gradedAt: Date | null; gradedById: string | null; score: number | null; maxScore: number | null }

/** a hand-in counts once it is not a draft any more (in-class marks count too) */
export const handedIn = (s: Pick<SubRow, 'status'> | undefined) => !!s && s.status !== 'DRAFT'

/** Homework that was due: on time / late / not handed in, for every student × assignment. */
export function homeworkStats(studentIds: string[], due: DueItem[], subs: SubRow[]) {
  const byKey = new Map(subs.map((s) => [`${s.blockId}|${s.studentId}`, s]))
  let onTime = 0, late = 0, missing = 0
  for (const d of due) {
    for (const st of studentIds) {
      const s = byKey.get(`${d.blockId}|${st}`)
      if (!handedIn(s)) missing++
      else if (s!.late) late++
      else onTime++
    }
  }
  const expected = onTime + late + missing
  return { expected, onTime, late, missing, onTimePct: pct(onTime, expected), latePct: pct(late, expected), missingPct: pct(missing, expected) }
}

/** Average % of scored rows (rows without a max are skipped). */
export function avgPercent(rows: { score: number | null; maxScore: number | null }[]): number | null {
  const ps = rows.filter((r) => r.score != null && !!r.maxScore).map((r) => (r.score! / r.maxScore!) * 100)
  return ps.length ? round1(ps.reduce((a, b) => a + b, 0) / ps.length) : null
}

/** Average hours between handing in and the instructor's grade (auto grades are not counted). */
export function gradingHours(rows: { submittedAt: Date | null; gradedAt: Date | null; gradedById: string | null }[]): number | null {
  const hs = rows.filter((r) => r.submittedAt && r.gradedAt && r.gradedById && r.gradedAt >= r.submittedAt).map((r) => (r.gradedAt!.getTime() - r.submittedAt!.getTime()) / 3_600_000)
  return hs.length ? round1(hs.reduce((a, b) => a + b, 0) / hs.length) : null
}

export interface AttemptRow { blockId: string; studentId: string; status: string; score: number | null; maxScore: number | null; createdAt: Date; submittedAt: Date | null; gradedAt: Date | null; gradedById: string | null }
export interface QuizInfo { blockId: string; passMark: number; scoring: (typeof SCORING)[number] }

/** One result per student × quiz (the quiz's own scoring rule), with the time of the last graded try. */
export function quizResults(attempts: AttemptRow[], quizzes: QuizInfo[]) {
  const out: { blockId: string; studentId: string; percent: number; passed: boolean; at: Date }[] = []
  for (const q of quizzes) {
    const graded = attempts.filter((a) => a.blockId === q.blockId && a.status === 'GRADED')
    for (const st of new Set(graded.map((a) => a.studentId))) {
      const mine = graded.filter((a) => a.studentId === st)
      const r = quizScore(mine, q.scoring)
      if (!r) continue
      const at = mine.reduce((m, a) => Math.max(m, (a.submittedAt ?? a.createdAt).getTime()), 0)
      out.push({ blockId: q.blockId, studentId: st, percent: r.percent, passed: r.percent >= q.passMark, at: new Date(at) })
    }
  }
  return out
}

export const avgOf = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

export type RiskReason = 'MISSED_HOMEWORK' | 'LOW_QUIZZES' | 'INACTIVE'

/**
 * Why a student needs follow-up:
 * - MISSED_HOMEWORK: the last 2 homework that were due were not handed in;
 * - LOW_QUIZZES: the last 2 quiz results are under the pass mark;
 * - INACTIVE: no lesson opened for 14 days although the group has open lessons and started 14+ days ago.
 */
export function riskReasons(o: {
  studentId: string; due: DueItem[]; subs: SubRow[]; results: { studentId: string; passed: boolean; at: Date }[]
  lastViewAt: Date | null; groupHasOpenLessons: boolean; groupStartDate: Date | null; now: Date
}): RiskReason[] {
  const out: RiskReason[] = []
  const lastDue = [...o.due].filter((d) => d.dueAt <= o.now).sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime()).slice(0, 2)
  if (lastDue.length === 2 && lastDue.every((d) => !handedIn(o.subs.find((s) => s.blockId === d.blockId && s.studentId === o.studentId)))) out.push('MISSED_HOMEWORK')
  const mine = o.results.filter((r) => r.studentId === o.studentId).sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 2)
  if (mine.length === 2 && mine.every((r) => !r.passed)) out.push('LOW_QUIZZES')
  const since = o.now.getTime() - INACTIVE_DAYS * DAY
  if (o.groupHasOpenLessons && o.groupStartDate && o.groupStartDate.getTime() <= since && (!o.lastViewAt || o.lastViewAt.getTime() < since)) out.push('INACTIVE')
  return out
}

/** Week starts (Sunday, UTC) covering [from, to] — at most 26 weeks (the latest ones). */
export function weekStarts(from: Date, to: Date): Date[] {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  start.setUTCDate(start.getUTCDate() - start.getUTCDay())
  const out: Date[] = []
  for (let d = start; d <= to; d = new Date(d.getTime() + 7 * DAY)) out.push(d)
  return out.slice(-26)
}

/** Count events per week (index of weekStarts); events outside are ignored. */
export function bucketWeeks(weeks: Date[], dates: (Date | null | undefined)[]): number[] {
  const counts = weeks.map(() => 0)
  for (const d of dates) {
    if (!d) continue
    const t = d.getTime()
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (t >= weeks[i].getTime()) { if (t < weeks[i].getTime() + 7 * DAY) counts[i]++; break }
    }
  }
  return counts
}

/** Which numbers of a group are weak (shown red). */
export function weakPoints(g: { openPct: number | null; onTimePct: number | null; quizAvg: number | null; homeworkAvg: number | null }): string[] {
  const out: string[] = []
  if (g.openPct != null && g.openPct < WEAK.openPct) out.push('openPct')
  if (g.onTimePct != null && g.onTimePct < WEAK.onTimePct) out.push('onTimePct')
  if (g.quizAvg != null && g.quizAvg < WEAK.quizAvg) out.push('quizAvg')
  if (g.homeworkAvg != null && g.homeworkAvg < WEAK.homeworkAvg) out.push('homeworkAvg')
  return out
}
