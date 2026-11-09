/**
 * Per-session rating questions (2026-11-09, owner). Pure, tests in tests/session-questions.test.ts.
 * Each answer is 1..5. A young child's parent answers with faces, which are stored as 1, 2, 4, 5.
 * A few questions per session (3 by default), rotating between sessions so children do not get bored.
 * SessionFeedback.rating stays 1..4, worked out from the answers, so old averages and reports keep working.
 */

export type QuestionAbout = 'SESSION' | 'INSTRUCTOR'
export interface RatingQuestion { id: string; en: string; ar: string; about: QuestionAbout; active: boolean }

export const DEFAULT_QUESTIONS: RatingQuestion[] = [
  { id: 'fun', en: 'Was the session fun?', ar: 'الحصة كانت ممتعة؟', about: 'SESSION', active: true },
  { id: 'understood', en: 'Did you understand the lesson?', ar: 'فهمت الدرس؟', about: 'SESSION', active: true },
  { id: 'explained', en: 'Did the instructor explain well?', ar: 'المدرب شرح كويس؟', about: 'INSTRUCTOR', active: true },
  { id: 'patient', en: 'Was the instructor patient and respectful?', ar: 'المدرب كان صبور ومحترم؟', about: 'INSTRUCTOR', active: true },
]

export const DEFAULT_PER_SESSION = 3

export function cleanQuestions(v: unknown): RatingQuestion[] {
  if (!Array.isArray(v) || !v.length) return DEFAULT_QUESTIONS
  const seen = new Set<string>()
  const out: RatingQuestion[] = []
  for (const q of v as Partial<RatingQuestion>[]) {
    const id = String(q?.id ?? '').trim().slice(0, 40)
    const en = String(q?.en ?? '').trim().slice(0, 120)
    const ar = String(q?.ar ?? '').trim().slice(0, 120)
    if (!id || seen.has(id) || (!en && !ar)) continue
    seen.add(id)
    out.push({ id, en: en || ar, ar: ar || en, about: q?.about === 'INSTRUCTOR' ? 'INSTRUCTOR' : 'SESSION', active: q?.active !== false })
  }
  return out.length ? out : DEFAULT_QUESTIONS
}

export const cleanPerSession = (n: unknown) => {
  const x = Number(n)
  return Number.isInteger(x) && x >= 1 && x <= 10 ? x : DEFAULT_PER_SESSION
}

/** The questions of one session: the same for everyone in that session, moving on from session to session. */
export function pickQuestions(all: RatingQuestion[], perSession: number, date: string): RatingQuestion[] {
  const active = all.filter((q) => q.active)
  if (active.length <= perSession) return active
  const dayNumber = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 86_400_000)
  const start = ((dayNumber % active.length) + active.length) % active.length
  return Array.from({ length: perSession }, (_, i) => active[(start + i) % active.length])
}

export type Answers = Record<string, number>

/** Answers must be exactly the questions asked, each 1..5. */
export function validAnswers(a: Answers, asked: RatingQuestion[]) {
  const keys = Object.keys(a)
  return keys.length === asked.length && asked.every((q) => Number.isInteger(a[q.id]) && a[q.id] >= 1 && a[q.id] <= 5)
}

/** Overall result: the average, the old 1..4 rating, and whether it is low enough to alert the managers. */
export function summarize(a: Answers) {
  const values = Object.values(a)
  const average = values.reduce((s, x) => s + x, 0) / values.length
  const rating = average <= 2 ? 1 : average <= 3 ? 2 : average <= 4 ? 3 : 4
  return { average: Math.round(average * 10) / 10, rating, low: average <= 2 }
}

/** The average of each question over many answers (no names). */
export function questionAverages(rows: (Answers | null | undefined)[], questions: RatingQuestion[]) {
  return questions.map((q) => {
    const xs = rows.map((r) => r?.[q.id]).filter((x): x is number => typeof x === 'number')
    return { id: q.id, en: q.en, ar: q.ar, about: q.about, count: xs.length, average: xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null }
  })
}
