/**
 * 2026-10-18 — what a student must finish in a session before the NEXT session opens (owner: a setting per session).
 * Any of: tick every part of the lesson (content), hand in the homework (or have it graded, with a lowest %), pass the
 * session quiz (lowest %, else the quiz's own pass mark). A late grade can open the next session after N days
 * (company setting `lms.settings.gateUngradedOpensAfterDays`, null = the student waits). Pure (tests/lms-gate.test.ts).
 */

export interface SessionGate {
  content?: boolean
  homework?: 'SUBMITTED' | 'GRADED' | null
  minHomeworkPct?: number | null
  quiz?: boolean
  minQuizPct?: number | null
}

export type GateMissing = 'CONTENT' | 'HOMEWORK' | 'HOMEWORK_GRADE' | 'HOMEWORK_SCORE' | 'QUIZ'

/** Facts about one student in one session. */
export interface GateFacts {
  contentDone: boolean
  homework: { status: string; pct: number | null; submittedAt: Date | null }[]
  /** one row per quiz of the session: best % so far (null = no graded try) and the quiz's pass mark */
  quizzes: { bestPct: number | null; passMark: number | null; waitingReview: boolean }[]
  /** one entry per homework block that has no hand-in at all */
  homeworkMissing: number
}

const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : null)

/** Clean a stored / posted gate; null when it asks for nothing. */
export function parseGate(v: unknown): SessionGate | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const g: SessionGate = {
    content: o.content === true,
    homework: o.homework === 'SUBMITTED' || o.homework === 'GRADED' ? o.homework : null,
    minHomeworkPct: o.homework === 'GRADED' ? pct(o.minHomeworkPct) : null,
    quiz: o.quiz === true,
    minQuizPct: o.quiz === true ? pct(o.minQuizPct) : null,
  }
  return g.content || g.homework || g.quiz ? g : null
}

const DONE_HOMEWORK = ['SUBMITTED', 'GRADED', 'EXCUSED']

export function gateMet(g: SessionGate | null, f: GateFacts, opts: { ungradedOpensAfterDays: number | null; now: Date }): { met: boolean; missing: GateMissing[] } {
  if (!g) return { met: true, missing: [] }
  const missing = new Set<GateMissing>()
  if (g.content && !f.contentDone) missing.add('CONTENT')
  if (g.homework) {
    if (f.homeworkMissing > 0) missing.add('HOMEWORK')
    for (const h of f.homework) {
      if (!DONE_HOMEWORK.includes(h.status)) { missing.add('HOMEWORK'); continue }
      if (g.homework !== 'GRADED' || h.status === 'EXCUSED') continue
      if (h.status === 'SUBMITTED') {
        const waitedEnough = opts.ungradedOpensAfterDays != null && h.submittedAt != null
          && opts.now.getTime() - h.submittedAt.getTime() >= opts.ungradedOpensAfterDays * 86_400_000
        if (!waitedEnough) missing.add('HOMEWORK_GRADE')
        continue
      }
      if (g.minHomeworkPct != null && (h.pct ?? 0) < g.minHomeworkPct) missing.add('HOMEWORK_SCORE')
    }
  }
  if (g.quiz) {
    for (const q of f.quizzes) {
      const need = g.minQuizPct ?? q.passMark ?? 0
      if (q.bestPct == null || q.bestPct < need) missing.add('QUIZ')
    }
  }
  return { met: missing.size === 0, missing: [...missing] }
}

/** Every session after the first unfinished gated session stays shut (no skipping): session → that session's number. */
export function blockedAfter(unmetGatedSessions: number[], totalSessions: number): Map<number, number> {
  const out = new Map<number, number>()
  if (!unmetGatedSessions.length) return out
  const first = Math.min(...unmetGatedSessions)
  for (let n = first + 1; n <= totalSessions; n++) out.set(n, first)
  return out
}

/** Short bilingual reason shown on a locked lesson. */
export function gateMessage(sessionNumber: number, missing: GateMissing[], g: SessionGate | null): { en: string; ar: string } {
  const en: string[] = [], ar: string[] = []
  if (missing.includes('CONTENT')) { en.push('finish every part of the lesson'); ar.push('تخلّص كل أجزاء الدرس') }
  if (missing.includes('HOMEWORK')) { en.push('hand in the homework'); ar.push('تسلّم الواجب') }
  if (missing.includes('HOMEWORK_GRADE')) { en.push('wait for the homework to be graded'); ar.push('تستنى تصحيح الواجب') }
  if (missing.includes('HOMEWORK_SCORE')) { en.push(`get at least ${g?.minHomeworkPct ?? 0}% in the homework`); ar.push(`تجيب ${g?.minHomeworkPct ?? 0}% على الأقل في الواجب`) }
  if (missing.includes('QUIZ')) { en.push(g?.minQuizPct != null ? `pass the quiz (${g.minQuizPct}% or more)` : 'pass the quiz'); ar.push(g?.minQuizPct != null ? `تنجح في الامتحان (${g.minQuizPct}% أو أكتر)` : 'تنجح في الامتحان') }
  return {
    en: `Opens after you ${en.join(' and ')} of session ${sessionNumber}.`,
    ar: `بتتفتح لما ${ar.join(' و')} في الحصة ${sessionNumber}.`,
  }
}
