/**
 * LMS L4 — quizzes & exams: pure rules (no DB; tests in tests/quizzes-rules.test.ts).
 *
 * Question types (all graded on the server except WRITE_CODE):
 *  SINGLE / MULTI / TRUE_FALSE / NUMBER / SHORT       — as in homework (lib/assignments/rules.ts)
 *  PICTURE      one picture choice (options with images, young children)
 *  ORDER        put items in order                   PARSONS   put code lines in order
 *  MATCH        match left ↔ right (partial credit)   MATCH_CODE  code ↔ output
 *  CODE_OUTPUT  what does this code print?            CODE_VALUE  value of a variable at the end
 *  FIND_BUG     which line has the mistake?           FILL_BLANK  fill the ___ in the code (partial credit)
 *  CHOOSE_CODE  which code does the task?             ERROR_MEANING  what does this error message mean?
 *  WRITE_CODE   write code; tests run in the browser, the instructor confirms
 * Correct answers never reach the browser before the attempt is submitted (stripQuestion).
 */

import { z } from 'zod'
import { gradeQuestion as gradeBasic, normalizeText, type Question as BasicQuestion } from '@/lib/assignments/rules'

export const QUIZ_QUESTION_TYPES = [
  'SINGLE', 'MULTI', 'TRUE_FALSE', 'NUMBER', 'SHORT', 'PICTURE', 'ORDER', 'PARSONS', 'MATCH', 'MATCH_CODE',
  'CODE_OUTPUT', 'CODE_VALUE', 'FIND_BUG', 'FILL_BLANK', 'CHOOSE_CODE', 'ERROR_MEANING', 'WRITE_CODE',
] as const
export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number]
export const CODE_TYPES: QuizQuestionType[] = ['PARSONS', 'MATCH_CODE', 'CODE_OUTPUT', 'CODE_VALUE', 'FIND_BUG', 'FILL_BLANK', 'CHOOSE_CODE', 'ERROR_MEANING', 'WRITE_CODE']

const media = z.object({ publicId: z.string().min(1).max(300), resourceType: z.enum(['image', 'video', 'raw']), format: z.string().max(10).optional() })
const option = z.object({ id: z.string().min(1).max(40), textEn: z.string().max(2000).default(''), textAr: z.string().max(2000).default(''), code: z.string().max(5000).optional(), media: media.optional() })

export const quizQuestionSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(QUIZ_QUESTION_TYPES),
  textEn: z.string().max(4000).default(''),
  textAr: z.string().max(4000).default(''),
  points: z.number().min(0).max(100).default(1),
  media: media.optional(),
  /** code shown with the question (CODE_OUTPUT, CODE_VALUE, FIND_BUG, FILL_BLANK with "___", ERROR_MEANING) */
  code: z.string().max(10000).optional(),
  language: z.enum(['python', 'javascript', 'arduino', 'text']).default('python'),
  options: z.array(option).max(10).default([]),
  /** option ids / accepted texts / [number] / [line number] / per-blank accepted answers joined by "|" */
  correct: z.array(z.union([z.string().max(500), z.number()])).max(20).default([]),
  tolerance: z.number().min(0).optional(),
  /** ORDER / PARSONS: items in the CORRECT order (shown shuffled) */
  items: z.array(z.object({ id: z.string().min(1).max(40), textEn: z.string().max(2000).default(''), textAr: z.string().max(2000).default('') })).max(15).default([]),
  /** MATCH / MATCH_CODE: correct pairs (right side shown shuffled) */
  pairs: z.array(z.object({ id: z.string().min(1).max(40), left: z.string().max(2000), right: z.string().max(2000) })).max(10).default([]),
  /** WRITE_CODE tests (browser) */
  tests: z.array(z.object({ id: z.string().min(1).max(40), input: z.string().max(5000).default(''), expected: z.string().max(5000), points: z.number().min(0).max(100).default(1) })).max(20).default([]),
  starter: z.string().max(10000).optional(),
  skillIds: z.array(z.string()).max(10).optional(),
})
export type QuizQuestion = z.infer<typeof quizQuestionSchema>

export const QUIZ_KINDS = ['SESSION', 'FINAL'] as const
export const SCORING = ['BEST', 'LAST', 'AVERAGE'] as const
export const QUIZ_ANSWERS = ['NEVER', 'AFTER_SUBMIT', 'AFTER_CLOSE'] as const

export const quizDataSchema = z.object({
  kind: z.enum(QUIZ_KINDS).default('SESSION'),
  instructionsEn: z.string().max(10000).default(''),
  instructionsAr: z.string().max(10000).default(''),
  questions: z.array(quizQuestionSchema).max(100).default([]),
  /** draw N random questions from the bank of this course / level (with optional difficulty / skill filter) */
  bank: z.object({ count: z.number().int().min(1).max(100), levelOnly: z.boolean().default(true), difficulty: z.number().int().min(1).max(3).nullish(), skillId: z.string().nullish() }).nullish(),
  timeLimitMin: z.number().int().min(0).max(300).default(0),
  /** null = default: 2 for session quizzes, 1 for the final exam */
  attempts: z.number().int().min(1).max(10).nullish(),
  scoring: z.enum(SCORING).default('BEST'),
  shuffleQuestions: z.boolean().default(true),
  shuffleOptions: z.boolean().default(true),
  passMark: z.number().min(0).max(100).default(50),
  showAnswers: z.enum(QUIZ_ANSWERS).default('AFTER_CLOSE'),
  /** students can start only after the instructor opens it in class (default for the final exam) */
  requireInstructorOpen: z.boolean().nullish(),
  /** the final exam may be done on paper: the instructor types the score and uploads a scan */
  allowPaper: z.boolean().default(true),
}).refine((d) => d.questions.length > 0 || !!d.bank, 'Add questions or take them from the bank')
export type QuizData = z.infer<typeof quizDataSchema>

export const attemptsAllowed = (q: QuizData) => q.attempts ?? (q.kind === 'FINAL' ? 1 : 2)
export const needsInstructorOpen = (q: QuizData) => q.requireInstructorOpen ?? q.kind === 'FINAL'

// ───────────────────────── random order (seeded, so a resumed attempt keeps its order) ─────────────────────────

function seeded(seed: string) {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296 }
}
export function shuffle<T>(arr: T[], seed: string): T[] {
  const r = seeded(seed), out = [...arr]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}

/** Picks `count` random questions (seeded) from a bank list. */
export const drawFromBank = <T>(bank: T[], count: number, seed: string): T[] => shuffle(bank, seed).slice(0, count)

// ───────────────────────── what the student gets ─────────────────────────

/** The question for the browser: no correct answers, options / items / right side in the attempt's order. */
export function stripQuestion(q: QuizQuestion, seed: string, shuffleOptions: boolean) {
  const base = { id: q.id, type: q.type, textEn: q.textEn, textAr: q.textAr, points: q.points, media: q.media, code: q.code, language: q.language, starter: q.starter }
  const opts = shuffleOptions && q.type !== 'TRUE_FALSE' ? shuffle(q.options, `${seed}:o:${q.id}`) : q.options
  return {
    ...base,
    options: opts.map((o) => ({ id: o.id, textEn: o.textEn, textAr: o.textAr, code: o.code, media: o.media })),
    items: q.type === 'ORDER' || q.type === 'PARSONS' ? shuffle(q.items, `${seed}:i:${q.id}`) : [],
    left: q.type === 'MATCH' || q.type === 'MATCH_CODE' ? q.pairs.map((p) => ({ id: p.id, text: p.left })) : [],
    right: q.type === 'MATCH' || q.type === 'MATCH_CODE' ? shuffle(q.pairs.map((p) => ({ id: p.id, text: p.right })), `${seed}:m:${q.id}`) : [],
    blanks: q.type === 'FILL_BLANK' ? Math.max(1, (q.code?.match(/___/g) ?? []).length) : 0,
    lines: q.type === 'FIND_BUG' ? (q.code ?? '').split('\n').length : 0,
    tests: q.type === 'WRITE_CODE' ? q.tests.map((t) => ({ id: t.id, input: t.input, expected: t.expected, points: t.points })) : [],
  }
}

// ───────────────────────── grading ─────────────────────────

export const normalizeCodeOutput = (s: string) => String(s ?? '').replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).join('\n').trim()
export type QuizAnswer = string | number | string[] | Record<string, string> | { results: { id: string; passed: boolean }[]; code: string } | null | undefined
export interface QuizResult { id: string; points: number; max: number; correct: boolean; review?: boolean }

/** One question. `answer` shapes: id / ids / text / number / ordered ids / {leftId: rightId} / blanks[] / {code, results}. */
export function gradeQuizQuestion(q: QuizQuestion, answer: QuizAnswer): QuizResult {
  const r: QuizResult = { id: q.id, points: 0, max: q.points, correct: false }
  if (answer === undefined || answer === null || answer === '') return q.type === 'WRITE_CODE' ? { ...r, review: true } : r
  const full = (ok: boolean): QuizResult => ({ ...r, correct: ok, points: ok ? q.points : 0 })
  const part = (good: number, total: number): QuizResult => {
    const pts = total ? Math.round((q.points * good / total) * 100) / 100 : 0
    return { ...r, points: pts, correct: good === total && total > 0 }
  }
  switch (q.type) {
    case 'SINGLE': case 'MULTI': case 'TRUE_FALSE': case 'NUMBER': case 'SHORT':
      return gradeBasic(q as unknown as BasicQuestion, answer as never) as QuizResult
    case 'PICTURE': case 'CHOOSE_CODE': case 'ERROR_MEANING':
      return full(q.correct.map(String).includes(String(answer)))
    case 'ORDER': case 'PARSONS': {
      const want = q.items.map((i) => i.id)
      return full(Array.isArray(answer) && answer.length === want.length && want.every((id, i) => answer[i] === id))
    }
    case 'MATCH': case 'MATCH_CODE': {
      const a = answer as Record<string, string>
      return part(q.pairs.filter((p) => a?.[p.id] === p.id).length, q.pairs.length)
    }
    case 'CODE_OUTPUT':
      return full(q.correct.some((c) => normalizeCodeOutput(String(c)) === normalizeCodeOutput(String(answer))))
    case 'CODE_VALUE': {
      const n = Number(normalizeText(String(answer)).replace(',', '.'))
      return full(q.correct.some((c) => (typeof c === 'number' || /^-?\d+(\.\d+)?$/.test(String(c))) && Number.isFinite(n)
        ? Math.abs(Number(c) - n) <= (q.tolerance ?? 0) + 1e-9
        : normalizeText(String(c)).replace(/^["']|["']$/g, '') === normalizeText(String(answer)).replace(/^["']|["']$/g, '')))
    }
    case 'FIND_BUG':
      return full(q.correct.map(Number).includes(Number(answer)))
    case 'FILL_BLANK': {
      const given = Array.isArray(answer) ? answer : [String(answer)]
      const good = q.correct.filter((acc, i) => String(acc).split('|').map((x) => normalizeText(x)).includes(normalizeText(String(given[i] ?? '')))).length
      return part(good, q.correct.length)
    }
    case 'WRITE_CODE': {
      const a = answer as { results?: { id: string; passed: boolean }[] }
      const total = q.tests.reduce((s, t) => s + t.points, 0) || 1
      const passed = q.tests.filter((t) => a?.results?.some((x) => x.id === t.id && x.passed)).reduce((s, t) => s + t.points, 0)
      return { ...r, points: Math.round((q.points * passed / total) * 100) / 100, correct: passed === total, review: true }
    }
    default:
      return r
  }
}

export function gradeQuiz(questions: QuizQuestion[], answers: Record<string, QuizAnswer>) {
  const detail = questions.map((q) => gradeQuizQuestion(q, answers?.[q.id]))
  return {
    score: Math.round(detail.reduce((s, d) => s + d.points, 0) * 100) / 100,
    max: questions.reduce((s, q) => s + q.points, 0),
    detail,
    needsReview: detail.some((d) => d.review),
  }
}

// ───────────────────────── attempts ─────────────────────────

export interface StartCheck { ok: boolean; code?: string; message?: string; resume?: boolean }

export function canStart(o: { now: Date; used: number; allowed: number; hasActive: boolean; needsOpen: boolean; isOpen: boolean; closesAt: Date | null }): StartCheck {
  if (o.hasActive) return { ok: true, resume: true }
  if (o.needsOpen && !o.isOpen) return { ok: false, code: 'NOT_OPEN', message: 'Your instructor has not opened this quiz yet' }
  if (o.closesAt && o.now.getTime() > o.closesAt.getTime()) return { ok: false, code: 'CLOSED', message: 'This quiz is closed' }
  if (o.used >= o.allowed) return { ok: false, code: 'NO_ATTEMPTS', message: 'No tries left' }
  return { ok: true }
}

/** Deadline of a new attempt (null = no time limit); never after the quiz closes. */
export function deadlineFor(start: Date, timeLimitMin: number, closesAt: Date | null): Date | null {
  const byLimit = timeLimitMin > 0 ? new Date(start.getTime() + timeLimitMin * 60_000) : null
  if (byLimit && closesAt) return byLimit < closesAt ? byLimit : closesAt
  return byLimit ?? closesAt
}

/** Answers are accepted until the deadline + a short grace for a slow network. */
export const GRACE_MS = 30_000
export const isExpired = (deadlineAt: Date | null, now: Date) => !!deadlineAt && now.getTime() > deadlineAt.getTime() + GRACE_MS

/** The student's quiz score from their graded attempts (paper results count as an attempt). */
export function quizScore(attempts: { score: number | null; maxScore: number | null; createdAt: Date }[], scoring: (typeof SCORING)[number]): { score: number; max: number; percent: number } | null {
  const done = attempts.filter((a) => a.score !== null && a.maxScore)
  if (!done.length) return null
  const pct = (a: (typeof done)[number]) => (a.score! / a.maxScore!) * 100
  let pick: number
  if (scoring === 'LAST') pick = pct([...done].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0])
  else if (scoring === 'AVERAGE') pick = done.reduce((s, a) => s + pct(a), 0) / done.length
  else pick = Math.max(...done.map(pct))
  const ref = done[done.length - 1]
  return { score: Math.round((pick / 100) * ref.maxScore! * 100) / 100, max: ref.maxScore!, percent: Math.round(pick * 100) / 100 }
}

// ───────────────────────── item analysis (managers) ─────────────────────────

/** Per question: how many answered, % correct, the most chosen wrong option. */
export function itemAnalysis(rows: { questions: QuizQuestion[]; answers: Record<string, QuizAnswer>; detail: QuizResult[] }[]) {
  const map = new Map<string, { id: string; textEn: string; type: string; answered: number; correct: number; wrong: Record<string, number> }>()
  for (const row of rows) {
    for (const q of row.questions) {
      const m = map.get(q.id) ?? { id: q.id, textEn: q.textEn, type: q.type, answered: 0, correct: 0, wrong: {} }
      const d = row.detail.find((x) => x.id === q.id)
      const a = row.answers?.[q.id]
      if (a !== undefined && a !== null && a !== '') {
        m.answered++
        if (d?.correct) m.correct++
        else if (typeof a === 'string' || typeof a === 'number') {
          const label = q.options.find((o) => o.id === String(a))?.textEn ?? String(a)
          m.wrong[label] = (m.wrong[label] ?? 0) + 1
        }
      }
      map.set(q.id, m)
    }
  }
  return [...map.values()].map((m) => ({
    ...m,
    percentCorrect: m.answered ? Math.round((m.correct / m.answered) * 100) : null,
    commonWrong: Object.entries(m.wrong).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  })).sort((a, b) => (a.percentCorrect ?? 101) - (b.percentCorrect ?? 101))
}
