/**
 * R1 session report — pure rules (no database). docs/plan-learning-platform.md §3 R1, owner decisions 2026-10-11:
 * - sent by itself N hours (default 3) after the session ends, or only when the instructor presses Send (MANUAL);
 *   the instructor always has at least 30 minutes after attendance is saved;
 * - homework not graded yet → "grading in progress" and the grade appears later by itself (parts are read live);
 * - grade release rules of the homework (L3) apply inside the report.
 * Tests: tests/session-reports.test.ts.
 */

import { z } from 'zod'
import { quizScore, type SCORING } from '@/lib/quizzes/rules'

export interface Phrase { id: string; en: string; ar: string }
export interface SessionReportSettings { enabled: boolean; mode: 'AUTO' | 'MANUAL'; hours: number; phrases: Phrase[] }

export const DEFAULT_PHRASES: Phrase[] = [
  { id: 'participated', en: 'Participated very well', ar: 'شارك كويس جدًا' },
  { id: 'focus', en: 'Needs more focus', ar: 'محتاج تركيز أكتر' },
  { id: 'project', en: 'Excellent project', ar: 'مشروعه ممتاز' },
  { id: 'helped', en: 'Helped classmates', ar: 'ساعد زمايله' },
  { id: 'creative', en: 'Very creative', ar: 'مبدع جدًا' },
  { id: 'questions', en: 'Asked great questions', ar: 'سأل أسئلة حلوة' },
  { id: 'practice', en: 'Should practise at home', ar: 'محتاج يتمرّن في البيت' },
  { id: 'improving', en: 'Improving every session', ar: 'بيتحسّن كل حصة' },
]

export const SESSION_REPORT_DEFAULTS: SessionReportSettings = { enabled: false, mode: 'AUTO', hours: 3, phrases: DEFAULT_PHRASES }

export const settingsSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['AUTO', 'MANUAL']),
  hours: z.number().min(0).max(72),
  phrases: z.array(z.object({ id: z.string().min(1).max(40), en: z.string().trim().min(1).max(80), ar: z.string().trim().max(80) })).max(40),
})

export const extrasSchema = z.object({
  groupNote: z.string().trim().max(1000).nullable().optional(),
  students: z.array(z.object({
    studentId: z.string().min(1),
    star: z.boolean().optional(),
    phrases: z.array(z.string().max(40)).max(10).optional(),
    comment: z.string().trim().max(500).nullable().optional(),
  })).max(200).optional(),
})

const MIN = 60_000
export const MIN_WINDOW_MIN = 30
export const DEFAULT_SESSION_MIN = 90

/** When the report goes out by itself (null = only by the instructor). */
export function computeSendAt(o: { mode: 'AUTO' | 'MANUAL'; hours: number; sessionEnd: Date | null; now: Date }): Date | null {
  if (o.mode === 'MANUAL') return null
  const floor = o.now.getTime() + MIN_WINDOW_MIN * MIN
  const planned = o.sessionEnd ? o.sessionEnd.getTime() + o.hours * 60 * MIN : o.now.getTime() + o.hours * 60 * MIN
  return new Date(Math.max(planned, floor))
}

/** Phrase ids kept only when they exist in the settings (old ids are dropped). */
export const cleanPhrases = (ids: string[] | undefined, phrases: Phrase[]) => [...new Set((ids ?? []).filter((id) => phrases.some((p) => p.id === id)))]

export type HomeworkState = 'DONE' | 'LATE' | 'MISSING' | 'NOT_DUE'
export type GradeState = 'SHOWN' | 'GRADING' | 'LATER' | 'RETURNED' | 'NONE'

/** One homework line of the report: handed in / late / missing, and the grade only when it may be shown. */
export function homeworkLine(o: {
  sub: { status: string; late: boolean; score: number | null; maxScore: number | null } | null
  dueAt: Date | null; now: Date; gradesVisible: boolean
}): { state: HomeworkState; grade: GradeState; score: number | null; maxScore: number | null } {
  const handed = !!o.sub && o.sub.status !== 'DRAFT'
  const state: HomeworkState = handed ? (o.sub!.late ? 'LATE' : 'DONE') : o.dueAt && o.dueAt <= o.now ? 'MISSING' : 'NOT_DUE'
  if (!handed) return { state, grade: 'NONE', score: null, maxScore: null }
  if (o.sub!.status === 'SUBMITTED') return { state, grade: 'GRADING', score: null, maxScore: null }
  if (o.sub!.status === 'RETURNED') return { state, grade: 'RETURNED', score: null, maxScore: null }
  if (!o.gradesVisible) return { state, grade: 'LATER', score: null, maxScore: null }
  return { state, grade: 'SHOWN', score: o.sub!.score, maxScore: o.sub!.maxScore }
}

/** The quiz line: result by the quiz's scoring rule, "grading" while a code answer waits, or not taken. */
export function quizLine(attempts: { status: string; score: number | null; maxScore: number | null; createdAt: Date }[], scoring: (typeof SCORING)[number], passMark: number) {
  const r = quizScore(attempts.filter((a) => a.status === 'GRADED'), scoring)
  if (r) return { state: 'DONE' as const, percent: r.percent, passed: r.percent >= passMark }
  if (attempts.some((a) => a.status === 'SUBMITTED')) return { state: 'GRADING' as const, percent: null, passed: null }
  return { state: 'NOT_TAKEN' as const, percent: null, passed: null }
}

/** What managers see as "report not complete" for one session. */
export function missingPieces(o: { ungradedHomework: number; quizReview: number }): ('HOMEWORK_UNGRADED' | 'QUIZ_REVIEW')[] {
  const out: ('HOMEWORK_UNGRADED' | 'QUIZ_REVIEW')[] = []
  if (o.ungradedHomework > 0) out.push('HOMEWORK_UNGRADED')
  if (o.quizReview > 0) out.push('QUIZ_REVIEW')
  return out
}
