/**
 * LMS L3 — assignments: pure rules (no DB; tests in tests/assignments-rules.test.ts).
 *
 * An assignment is an ASSIGNMENT block of the curriculum. It can mix:
 *  - questions graded automatically (single / multiple choice, true-false, number with tolerance, short answer);
 *  - work the instructor grades (text, files, photos, video, links, "done in class") with points, a rubric or stars.
 * Grading mode: MANUAL (instructor), AUTO (questions only → final at once), AUTO_REVIEW (auto score is a suggestion
 * the instructor confirms). Correct answers never leave the server (stripForStudent).
 */

import { z } from 'zod'
import { toolCheckSchema, toolMax } from './tool-checks'

export const SUBMISSION_KINDS = ['TEXT', 'FILE', 'PHOTO', 'VIDEO', 'LINK', 'IN_CLASS', 'CODE'] as const
export const CODE_LANGUAGES = ['python', 'javascript', 'arduino'] as const
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number]
export const QUESTION_TYPES = ['SINGLE', 'MULTI', 'TRUE_FALSE', 'NUMBER', 'SHORT'] as const
export const GRADING_MODES = ['MANUAL', 'AUTO', 'AUTO_REVIEW'] as const
export type GradingMode = (typeof GRADING_MODES)[number]
export const SCALES = ['POINTS', 'RUBRIC', 'STARS'] as const

const option = z.object({ id: z.string().min(1).max(40), textEn: z.string().max(500).default(''), textAr: z.string().max(500).default('') })
export const questionSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(QUESTION_TYPES),
  textEn: z.string().max(2000).default(''),
  textAr: z.string().max(2000).default(''),
  options: z.array(option).max(10).default([]),
  /** option ids (SINGLE / MULTI / TRUE_FALSE: 'true' | 'false'), accepted texts (SHORT) or [number] (NUMBER) */
  correct: z.array(z.union([z.string().max(200), z.number()])).max(10).default([]),
  tolerance: z.number().min(0).max(1_000_000).optional(),
  points: z.number().min(0).max(100).default(1),
})
export type Question = z.infer<typeof questionSchema>

export const criterionSchema = z.object({
  id: z.string().min(1).max(40),
  titleEn: z.string().max(200).default(''),
  titleAr: z.string().max(200).default(''),
  levels: z.array(z.object({ labelEn: z.string().max(80).default(''), labelAr: z.string().max(80).default(''), points: z.number().min(0).max(100), descEn: z.string().max(500).default(''), descAr: z.string().max(500).default('') })).min(1).max(6),
})
export type Criterion = z.infer<typeof criterionSchema>
export const rubricCriteriaSchema = z.array(criterionSchema).min(1).max(12)

export const assignmentDataSchema = z.object({
  instructionsEn: z.string().max(20000).default(''),
  instructionsAr: z.string().max(20000).default(''),
  kinds: z.array(z.enum(SUBMISSION_KINDS)).max(6).default(['FILE']),
  questions: z.array(questionSchema).max(50).default([]),
  scale: z.enum(SCALES).default('POINTS'),
  maxPoints: z.number().min(0).max(1000).default(10),
  rubricId: z.string().nullish(),
  /** copy of the rubric at the time it was chosen (later edits of the library do not change graded work) */
  rubric: z.object({ nameEn: z.string().default(''), nameAr: z.string().default(''), criteria: rubricCriteriaSchema, kidStars: z.boolean().default(false) }).nullish(),
  gradingMode: z.enum(GRADING_MODES).default('MANUAL'),
  finalProject: z.boolean().default(false),
  /** batch 2: code written in the editor; Python / JavaScript tests run in the student's browser */
  code: z.object({
    language: z.enum(CODE_LANGUAGES),
    starter: z.string().max(20000).default(''),
    tests: z.array(z.object({ id: z.string().min(1).max(40), input: z.string().max(5000).default(''), expected: z.string().max(5000), points: z.number().min(0).max(100).default(1) })).max(30).default([]),
  }).nullish(),
  /** batch 2: automatic checks of the tool project (link / file / Arduino code); can be switched off */
  toolCheck: toolCheckSchema.nullish(),
  autoCheck: z.boolean().default(true),
}).refine((d) => d.kinds.length > 0 || d.questions.length > 0, 'Choose at least one way to hand in, or add questions')
  .refine((d) => d.gradingMode === 'MANUAL' || d.questions.length > 0 || (d.autoCheck && !!d.toolCheck) || codeTestsMax(d) > 0, 'Automatic grading needs questions, code tests or tool checks')
  .refine((d) => !d.kinds.includes('CODE') || !!d.code, 'Choose the code language')
  .refine((d) => d.scale !== 'RUBRIC' || !manualKinds(d.kinds).length || !!d.rubric, 'Choose a rubric')
export type AssignmentData = z.infer<typeof assignmentDataSchema>

/** Kinds the instructor has to look at ("done in class" too: the instructor ticks it). */
export const manualKinds = (kinds: readonly string[]) => kinds.filter((k) => k !== 'CODE' && (SUBMISSION_KINDS as readonly string[]).includes(k))

/** Points of the code tests (Arduino has no tests: its checks are tool rules). */
export function codeTestsMax(a: { kinds?: string[]; code?: { language?: string; tests?: { points?: number }[] } | null }): number {
  if (!a.kinds?.includes('CODE') || !a.code || a.code.language === 'arduino') return 0
  return (a.code.tests ?? []).reduce((s, t) => s + (t.points ?? 0), 0)
}
export const toolChecksMax = (a: { autoCheck?: boolean; toolCheck?: Parameters<typeof toolMax>[0] }) => (a.autoCheck ? toolMax(a.toolCheck) : 0)
/** Everything graded by the computer (questions + code tests + tool checks). */
export const autoMax = (a: AssignmentData) => questionsMax(a.questions) + codeTestsMax(a) + toolChecksMax(a)

export const rubricMax = (criteria: Criterion[]) => criteria.reduce((s, c) => s + Math.max(...c.levels.map((l) => l.points)), 0)
export const questionsMax = (qs: Question[]) => qs.reduce((s, q) => s + q.points, 0)

/** Points of the instructor-graded part (0 when the assignment has only questions). */
export function manualMax(a: AssignmentData): number {
  if (!manualKinds(a.kinds).length) return 0
  if (a.scale === 'RUBRIC') return a.rubric ? rubricMax(a.rubric.criteria) : 0
  if (a.scale === 'STARS') return 3
  return a.maxPoints
}
export const totalMax = (a: AssignmentData) => autoMax(a) + manualMax(a)

/** Copy for students: no correct answers / tolerances. */
export function stripForStudent(a: AssignmentData) {
  return { ...a, questions: a.questions.map(({ correct: _c, tolerance: _t, ...q }) => q) }
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
export function normalizeText(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[ً-ْ]/g, '') // Arabic diacritics
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .trim().replace(/\s+/g, ' ').toLowerCase()
}

export type Answers = Record<string, string | string[] | number | null | undefined>
export interface QuestionResult { id: string; points: number; max: number; correct: boolean }

export function gradeQuestion(q: Question, answer: Answers[string]): QuestionResult {
  const r = { id: q.id, max: q.points, points: 0, correct: false }
  if (answer === undefined || answer === null || answer === '') return r
  let ok = false
  if (q.type === 'SINGLE' || q.type === 'TRUE_FALSE') ok = q.correct.map(String).includes(String(answer))
  else if (q.type === 'MULTI') {
    const want = new Set(q.correct.map(String))
    const got = new Set((Array.isArray(answer) ? answer : [answer]).map(String))
    ok = want.size === got.size && [...want].every((x) => got.has(x))
  } else if (q.type === 'NUMBER') {
    const n = Number(normalizeText(String(answer)).replace(',', '.'))
    ok = Number.isFinite(n) && q.correct.some((c) => Math.abs(Number(c) - n) <= (q.tolerance ?? 0) + 1e-9)
  } else if (q.type === 'SHORT') {
    const a = normalizeText(String(answer))
    ok = q.correct.some((c) => normalizeText(String(c)) === a)
  }
  return { ...r, correct: ok, points: ok ? q.points : 0 }
}

export function gradeQuestions(qs: Question[], answers: Answers) {
  const detail = qs.map((q) => gradeQuestion(q, answers?.[q.id]))
  return { score: detail.reduce((s, d) => s + d.points, 0), max: questionsMax(qs), detail }
}

/** Rubric: picks = { criterionId: level index }. Every criterion must be picked. */
export function rubricScore(criteria: Criterion[], picks: Record<string, number>): { ok: boolean; points: number; max: number } {
  let points = 0
  for (const c of criteria) {
    const i = picks?.[c.id]
    if (i === undefined || i === null || !c.levels[i]) return { ok: false, points: 0, max: rubricMax(criteria) }
    points += c.levels[i].points
  }
  return { ok: true, points, max: rubricMax(criteria) }
}

/** Final score = (auto + manual) minus the late penalty, never below 0, rounded to 2 decimals. */
export function finalScore(auto: number, manual: number, latePenaltyPct = 0): number {
  const raw = (auto + manual) * (1 - Math.min(100, Math.max(0, latePenaltyPct)) / 100)
  return Math.max(0, Math.round(raw * 100) / 100)
}

export const percentOf = (score: number | null | undefined, max: number | null | undefined) =>
  score === null || score === undefined || !max ? null : Math.round((score / max) * 10000) / 100

// ───────────────────────── policy (LMS settings: company > level > group) ─────────────────────────

export const LATE_RULES = ['ALLOWED', 'MARK_LATE', 'CLOSED'] as const
/** When students (and parents) see the correct answers of the questions. */
export const ANSWER_RELEASE = ['NEVER', 'AFTER_SUBMIT', 'AFTER_DUE', 'AFTER_NEXT_SESSION'] as const
/** When they see the grade + feedback (owner 2026-10-10: e.g. after the session that follows the homework). */
export const GRADE_RELEASE = ['IMMEDIATE', 'AFTER_DUE', 'AFTER_NEXT_SESSION'] as const
/** Who sees approved projects in the gallery: the student only / their group / everyone at TechNova. */
export const GALLERY_SCOPES = ['OWN', 'GROUP', 'ALL'] as const
export interface AssignmentPolicy {
  late: (typeof LATE_RULES)[number]
  latePenaltyPct: number
  resubmit: boolean
  maxAttempts: number
  /** an approved absence excuse moves the student's due date by this many days */
  excuseExtensionDays: number
  /** parents may hand in for young children (kid mode age) */
  parentCanSubmit: boolean
  showAnswers: (typeof ANSWER_RELEASE)[number]
  showGrades: (typeof GRADE_RELEASE)[number]
  gallery: (typeof GALLERY_SCOPES)[number]
}
export const POLICY_DEFAULTS: AssignmentPolicy = { late: 'MARK_LATE', latePenaltyPct: 0, resubmit: true, maxAttempts: 2, excuseExtensionDays: 7, parentCanSubmit: true, showAnswers: 'AFTER_DUE', showGrades: 'IMMEDIATE', gallery: 'GROUP' }
export const policySchema = z.object({
  late: z.enum(LATE_RULES), latePenaltyPct: z.number().min(0).max(100), resubmit: z.boolean(),
  maxAttempts: z.number().int().min(1).max(10), excuseExtensionDays: z.number().int().min(0).max(60), parentCanSubmit: z.boolean(),
  showAnswers: z.enum(ANSWER_RELEASE).default('AFTER_DUE'), showGrades: z.enum(GRADE_RELEASE).default('IMMEDIATE'),
  gallery: z.enum(GALLERY_SCOPES).default('GROUP'),
})

export function resolvePolicy(company?: Partial<AssignmentPolicy> | null, level?: Partial<AssignmentPolicy> | null, group?: Partial<AssignmentPolicy> | null): AssignmentPolicy {
  return { ...POLICY_DEFAULTS, ...(company ?? {}), ...(level ?? {}), ...(group ?? {}) }
}

export interface SubmitCheck { ok: boolean; late: boolean; code?: string; message?: string }

/**
 * May the student hand in now? status / attempt = their current submission (null = none yet).
 * A GRADED or SUBMITTED piece can be handed in again only with resubmission on and attempts left;
 * RETURNED (instructor asked for changes) always may.
 */
export function canSubmit(opts: { now: Date; dueAt: Date | null; policy: AssignmentPolicy; status: string | null; attempt: number }): SubmitCheck {
  const late = !!opts.dueAt && opts.now.getTime() > opts.dueAt.getTime()
  if (late && opts.policy.late === 'CLOSED') return { ok: false, late, code: 'CLOSED', message: 'The due date has passed' }
  if (opts.status === 'SUBMITTED' || opts.status === 'GRADED') {
    if (!opts.policy.resubmit) return { ok: false, late, code: 'NO_RESUBMIT', message: 'Handing in again is not allowed' }
    if (opts.attempt >= opts.policy.maxAttempts) return { ok: false, late, code: 'NO_ATTEMPTS', message: 'No tries left' }
  }
  return { ok: true, late }
}

/** Penalty that applies to this hand-in. */
export const penaltyFor = (late: boolean, policy: AssignmentPolicy) => (late && policy.late !== 'ALLOWED' ? policy.latePenaltyPct : 0)

/**
 * Is it time to show answers / grades? `nextSessionAt` = start of the session after the homework's lesson;
 * when the needed date is unknown (no due date / no schedule) we show at once rather than never.
 */
export function released(rule: string, o: { now: Date; submitted: boolean; dueAt: Date | null; nextSessionAt: Date | null }): boolean {
  if (rule === 'NEVER') return false
  if (rule === 'IMMEDIATE') return true
  if (rule === 'AFTER_SUBMIT') return o.submitted
  const at = rule === 'AFTER_DUE' ? o.dueAt : o.nextSessionAt
  return !at || o.now.getTime() >= at.getTime()
}

/** When a hidden result becomes visible (for "results on …" texts and the daily notification). */
export function releaseAt(rule: string, o: { dueAt: Date | null; nextSessionAt: Date | null }): Date | null {
  if (rule === 'AFTER_DUE') return o.dueAt
  if (rule === 'AFTER_NEXT_SESSION') return o.nextSessionAt
  return null
}

// ───────────────────────── similarity (code / text copied from a classmate) ─────────────────────────

/** Normalised text for comparing two hand-ins: comments, spaces and case ignored. */
export function similarityText(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)(#|\/\/).*$/gm, ' ').toLowerCase().replace(/\s+/g, ' ').trim()
}

function shingles(s: string, n = 5): Set<string> {
  const out = new Set<string>()
  const t = similarityText(s)
  if (t.length <= n) { if (t) out.add(t); return out }
  for (let i = 0; i <= t.length - n; i++) out.add(t.slice(i, i + n))
  return out
}

/** 0..1 (Jaccard of 5-character pieces). Short texts (< 40 chars) are never compared. */
export function similarity(a: string, b: string): number {
  if (similarityText(a).length < 40 || similarityText(b).length < 40) return 0
  const x = shingles(a), y = shingles(b)
  let common = 0
  for (const v of x) if (y.has(v)) common++
  return common / (x.size + y.size - common || 1)
}
