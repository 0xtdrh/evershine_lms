/**
 * LMS L4 — quizzes & exams (docs/plan-learning-platform.md §2 L4). Server-only. Pure rules: ./rules.ts.
 *
 * - A quiz = a QUIZ block of the group's curriculum version; open when its lesson is open (+ the instructor opened it,
 *   default for the final exam). Questions = the block's own + N random ones from the course bank.
 * - An attempt freezes its questions (with answers, server-side only) and its deadline; answers are saved as the
 *   student goes; an expired attempt is submitted automatically the next time anyone looks at it.
 * - Grading on the server; WRITE_CODE answers wait for the instructor. Final exam on paper: typed score + scan.
 * - Level result: session quizzes → "task" %, final exam → "MCQ" %.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { visibleTo } from '@/lib/curriculum/blocks'
import { canManageGroupLessons, studentLessonAccess, studentLessonGroups, groupLessons } from '@/lib/lms/engine'
import {
  attemptsAllowed, canStart, deadlineFor, drawFromBank, gradeQuiz, isExpired, itemAnalysis, needsInstructorOpen,
  quizDataSchema, quizQuestionSchema, quizScore, shuffle, stripQuestion,
  type QuizAnswer, type QuizData, type QuizQuestion, type QuizResult,
} from './rules'

export interface Outcome<T = undefined> { ok: boolean; code?: string; message?: string; value?: T }
const fail = (code: string, message: string) => ({ ok: false, code, message })

export function parseQuiz(data: unknown): QuizData | null {
  const r = quizDataSchema.safeParse(data ?? {})
  return r.success ? r.data : null
}

/** Summary of a quiz for lesson pages (no questions). */
export const quizSummary = (q: QuizData) => ({
  kind: q.kind, instructionsEn: q.instructionsEn, instructionsAr: q.instructionsAr, timeLimitMin: q.timeLimitMin,
  questionCount: q.questions.length + (q.bank?.count ?? 0), attempts: attemptsAllowed(q), passMark: q.passMark,
})

async function loadQuizBlock(blockId: string) {
  const b = await prisma.curriculumBlock.findUnique({ where: { id: blockId } })
  if (!b || b.type !== 'QUIZ' || !visibleTo(b.audience, 'STUDENT')) return null
  const data = parseQuiz(b.data)
  return data ? { b, data } : null
}

const windowOf = (groupId: string, blockId: string) => prisma.quizWindow.findUnique({ where: { classSectionId_blockId: { classSectionId: groupId, blockId } } })

// ───────────────────────── finishing attempts ─────────────────────────

async function finalize(a: { id: string; questions: Prisma.JsonValue; answers: Prisma.JsonValue }) {
  const qs = (a.questions as unknown as QuizQuestion[]) ?? []
  const g = gradeQuiz(qs, (a.answers as Record<string, QuizAnswer>) ?? {})
  return prisma.quizAttempt.update({
    where: { id: a.id },
    data: {
      status: g.needsReview ? 'SUBMITTED' : 'GRADED', submittedAt: new Date(), autoScore: g.score, maxScore: g.max,
      score: g.needsReview ? null : g.score, needsReview: g.needsReview, detail: g.detail as unknown as Prisma.InputJsonValue,
      ...(g.needsReview ? {} : { gradedAt: new Date() }),
    },
  })
}

/** Submits every attempt whose time ran out (called before reading attempts). */
export async function finishExpired(where: Prisma.QuizAttemptWhereInput) {
  const open = await prisma.quizAttempt.findMany({ where: { ...where, status: 'IN_PROGRESS', deadlineAt: { not: null } }, select: { id: true, deadlineAt: true, questions: true, answers: true } })
  const now = new Date()
  for (const a of open) if (isExpired(a.deadlineAt, now)) await finalize(a)
}

// ───────────────────────── student ─────────────────────────

async function context(studentId: string, groupId: string, blockId: string) {
  const qb = await loadQuizBlock(blockId)
  if (!qb) return { err: fail('NOT_FOUND', 'Quiz not found') }
  const access = await studentLessonAccess(studentId, groupId, qb.b.sessionId)
  if (!access.ok) return { err: fail(access.code!, access.message!) }
  await finishExpired({ blockId, studentId, classSectionId: groupId })
  const [attempts, win] = await Promise.all([
    prisma.quizAttempt.findMany({ where: { blockId, studentId, classSectionId: groupId }, orderBy: { createdAt: 'asc' } }),
    windowOf(groupId, blockId),
  ])
  const allowed = attemptsAllowed(qb.data)
  const used = attempts.filter((a) => !a.paper).length
  const active = attempts.find((a) => a.status === 'IN_PROGRESS') ?? null
  const check = canStart({ now: new Date(), used, allowed, hasActive: !!active, needsOpen: needsInstructorOpen(qb.data), isOpen: !!win?.open, closesAt: win?.closesAt ?? null })
  const closed = (needsInstructorOpen(qb.data) && !!win && !win.open) || (!!win?.closesAt && win.closesAt < new Date())
  return { ...qb, attempts, win, allowed, used, active, check, closed }
}

/** May the student see the correct answers of a finished attempt? */
function answersVisible(data: QuizData, c: { used: number; allowed: number; closed: boolean }) {
  if (data.showAnswers === 'NEVER') return false
  if (data.showAnswers === 'AFTER_SUBMIT') return true
  return c.closed || c.used >= c.allowed
}

function attemptForStudent(a: Prisma.QuizAttemptGetPayload<object>, data: QuizData, showKey: boolean) {
  const qs = (a.questions as unknown as QuizQuestion[]) ?? []
  const done = a.status !== 'IN_PROGRESS'
  return {
    id: a.id, attemptNo: a.attemptNo, status: a.status, paper: a.paper, startedAt: a.startedAt, deadlineAt: a.deadlineAt, submittedAt: a.submittedAt,
    serverNow: new Date(), score: a.score, maxScore: a.maxScore, feedback: done ? a.feedback : null, needsReview: a.needsReview,
    questions: a.paper ? [] : qs.map((q) => stripQuestion(q, a.id, data.shuffleOptions)),
    answers: a.answers ?? {},
    detail: done ? ((a.detail as unknown as QuizResult[]) ?? []).map((d) => ({ id: d.id, correct: d.correct, points: d.points, max: d.max })) : null,
    key: done && showKey ? Object.fromEntries(qs.map((q) => [q.id, answerKeyOf(q)])) : null,
    scanFiles: a.paper ? ((a.scanFiles as { originalName?: string }[] | null) ?? []).map((f, i) => ({ name: f.originalName ?? `scan ${i + 1}`, url: `/api/quizzes/scan/${a.id}?i=${i}` })) : [],
  }
}

/** A readable correct answer for the result page. */
export function answerKeyOf(q: QuizQuestion): string {
  const opt = (id: string | number) => { const o = q.options.find((x) => x.id === String(id)); return o ? (o.textEn || o.textAr || o.code || o.id) : String(id) }
  switch (q.type) {
    case 'SINGLE': case 'MULTI': case 'PICTURE': case 'CHOOSE_CODE': case 'ERROR_MEANING': return q.correct.map(opt).join(' / ')
    case 'TRUE_FALSE': return String(q.correct[0]) === 'true' ? 'True / صح' : 'False / خطأ'
    case 'ORDER': case 'PARSONS': return q.items.map((i, n) => `${n + 1}. ${i.textEn || i.textAr}`).join('\n')
    case 'MATCH': case 'MATCH_CODE': return q.pairs.map((p) => `${p.left} → ${p.right}`).join('\n')
    case 'FIND_BUG': return `line ${q.correct.join(', ')}`
    case 'FILL_BLANK': return q.correct.map((c, i) => `${i + 1}: ${String(c).split('|')[0]}`).join(' · ')
    case 'WRITE_CODE': return 'checked by your instructor'
    default: return q.correct.join(' / ') + (q.tolerance ? ` (±${q.tolerance})` : '')
  }
}

/** Quiz page data for a student (or a parent: read-only). */
export async function studentQuiz(studentId: string, groupId: string, blockId: string) {
  const c = await context(studentId, groupId, blockId)
  if ('err' in c && c.err) return c.err
  const ctx = c as Exclude<typeof c, { err: unknown }>
  const showKey = answersVisible(ctx.data, ctx)
  const graded = ctx.attempts.filter((a) => a.status === 'GRADED')
  return {
    ok: true,
    value: {
      blockId, groupId, titleEn: ctx.b.titleEn, titleAr: ctx.b.titleAr, quiz: quizSummary(ctx.data), scoring: ctx.data.scoring,
      used: ctx.used, allowed: ctx.allowed, canStart: ctx.check, open: !!ctx.win?.open, needsOpen: needsInstructorOpen(ctx.data),
      result: quizScore(graded, ctx.data.scoring),
      attempts: ctx.attempts.filter((a) => a.status !== 'IN_PROGRESS').map((a) => attemptForStudent(a, ctx.data, showKey)),
      active: ctx.active ? attemptForStudent(ctx.active, ctx.data, false) : null,
    },
  }
}

/** Starts (or resumes) an attempt: freezes the questions and the deadline. */
export async function startAttempt(studentId: string, groupId: string, blockId: string, meta: { ip?: string | null; userAgent?: string | null }): Promise<Outcome<{ attemptId: string }>> {
  const c = await context(studentId, groupId, blockId)
  if ('err' in c && c.err) return c.err
  const ctx = c as Exclude<typeof c, { err: unknown }>
  if (!ctx.check.ok) return fail(ctx.check.code!, ctx.check.message!)
  if (ctx.active) return { ok: true, value: { attemptId: ctx.active.id } }
  let questions: QuizQuestion[] = [...ctx.data.questions]
  if (ctx.data.bank) {
    const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { levelId: true, level: { select: { subjectId: true } } } })
    const rows = g?.level ? await prisma.question.findMany({
      where: {
        subjectId: g.level.subjectId, isActive: true,
        ...(ctx.data.bank.levelOnly && g.levelId ? { levelId: g.levelId } : {}),
        ...(ctx.data.bank.difficulty ? { difficulty: ctx.data.bank.difficulty } : {}),
      },
    }) : []
    const pool = rows
      .filter((r) => !ctx.data.bank!.skillId || ((r.skillIds as string[] | null) ?? []).includes(ctx.data.bank!.skillId))
      .map((r) => quizQuestionSchema.safeParse({ ...(r.data as object), id: `bank_${r.id}`, type: r.type, textEn: r.textEn, textAr: r.textAr, points: r.points }))
      .filter((x) => x.success).map((x) => (x as { data: QuizQuestion }).data)
    questions = [...questions, ...drawFromBank(pool, ctx.data.bank.count, `${studentId}:${blockId}:${ctx.used}`)]
  }
  if (!questions.length) return fail('EMPTY', 'This quiz has no questions yet')
  const now = new Date()
  const seed = `${studentId}:${blockId}:${ctx.used}:${now.getTime()}`
  if (ctx.data.shuffleQuestions) questions = shuffle(questions, seed)
  const a = await prisma.quizAttempt.create({
    data: {
      blockId, sessionId: ctx.b.sessionId, classSectionId: groupId, studentId, attemptNo: ctx.used + 1,
      deadlineAt: deadlineFor(now, ctx.data.timeLimitMin, ctx.win?.closesAt ?? null),
      questions: questions as unknown as Prisma.InputJsonValue, answers: {}, maxScore: questions.reduce((s, q) => s + q.points, 0),
      ip: meta.ip?.slice(0, 64) ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  })
  return { ok: true, value: { attemptId: a.id } }
}

/** Saves answers while the attempt runs; submit = true hands it in (graded at once unless written code). */
export async function saveAttempt(studentId: string, attemptId: string, answers: Record<string, QuizAnswer>, submit: boolean): Promise<Outcome<{ status: string; score: number | null }>> {
  const a = await prisma.quizAttempt.findUnique({ where: { id: attemptId } })
  if (!a || a.studentId !== studentId) return fail('NOT_FOUND', 'Attempt not found')
  if (a.status !== 'IN_PROGRESS') return fail('LOCKED', 'This try is already handed in')
  const qs = (a.questions as unknown as QuizQuestion[]) ?? []
  const ids = new Set(qs.map((q) => q.id))
  const clean = Object.fromEntries(Object.entries(answers ?? {}).filter(([k]) => ids.has(k))) as Record<string, QuizAnswer>
  if (isExpired(a.deadlineAt, new Date())) {
    const done = await finalize(a)
    return fail('TIME_UP', `Time is up — your answers were handed in${done.score !== null ? ` (${done.score}/${done.maxScore})` : ''}`)
  }
  const saved = await prisma.quizAttempt.update({ where: { id: a.id }, data: { answers: clean as unknown as Prisma.InputJsonValue } })
  if (!submit) return { ok: true, value: { status: 'IN_PROGRESS', score: null } }
  const done = await finalize(saved)
  try {
    if (done.status === 'GRADED') await prisma.lessonProgress.upsert({ where: { studentId_blockId: { studentId, blockId: a.blockId } }, create: { studentId, blockId: a.blockId, sessionId: a.sessionId, classSectionId: a.classSectionId }, update: {} })
  } catch { /* progress is a nice-to-have */ }
  return { ok: true, value: { status: done.status, score: done.score } }
}

/** Quizzes of the student's groups (open lessons) with tries and score. */
export async function studentQuizzes(studentId: string) {
  const out = []
  for (const gid of await studentLessonGroups(studentId)) {
    const gl = await groupLessons(gid, { studentId })
    if (!gl?.edition) continue
    const open = gl.sessions.filter((s) => s.open)
    const blocks = await prisma.curriculumBlock.findMany({ where: { sessionId: { in: open.map((s) => s.id) }, type: 'QUIZ' }, orderBy: { order: 'asc' } })
    const items = []
    for (const b of blocks) {
      const data = parseQuiz(b.data)
      if (!data || !visibleTo(b.audience, 'STUDENT')) continue
      await finishExpired({ blockId: b.id, studentId, classSectionId: gid })
      const atts = await prisma.quizAttempt.findMany({ where: { blockId: b.id, studentId, classSectionId: gid } })
      const s = open.find((x) => x.id === b.sessionId)!
      items.push({
        blockId: b.id, sessionNumber: s.number, titleEn: b.titleEn, titleAr: b.titleAr, kind: data.kind, timeLimitMin: data.timeLimitMin,
        used: atts.filter((x) => !x.paper).length, allowed: attemptsAllowed(data), inProgress: atts.some((x) => x.status === 'IN_PROGRESS'),
        waiting: atts.some((x) => x.status === 'SUBMITTED'), result: quizScore(atts.filter((x) => x.status === 'GRADED'), data.scoring), passMark: data.passMark,
      })
    }
    if (items.length) out.push({ group: { id: gid, label: gl.group.label, courseName: gl.group.courseName, levelName: gl.group.levelName }, items })
  }
  return out
}

// ───────────────────────── staff ─────────────────────────

/** Quizzes of a group with every student's score; window state; review queue. */
export async function groupQuizzes(groupId: string) {
  const gl = await groupLessons(groupId)
  if (!gl?.edition) return { quizzes: [], students: [] }
  const blocks = await prisma.curriculumBlock.findMany({ where: { sessionId: { in: gl.sessions.map((s) => s.id) }, type: 'QUIZ' }, orderBy: { order: 'asc' } })
  const students = await prisma.studentEnrollment.findMany({
    where: { classSectionId: groupId, status: 'ACTIVE' }, orderBy: { student: { firstName: 'asc' } },
    select: { studentId: true, student: { select: { firstName: true, lastName: true } } },
  })
  await finishExpired({ classSectionId: groupId })
  const quizzes = []
  for (const b of blocks) {
    const data = parseQuiz(b.data)
    if (!data) continue
    const s = gl.sessions.find((x) => x.id === b.sessionId)!
    const [win, atts] = await Promise.all([windowOf(groupId, b.id), prisma.quizAttempt.findMany({ where: { classSectionId: groupId, blockId: b.id }, select: { id: true, studentId: true, status: true, score: true, maxScore: true, createdAt: true, paper: true, needsReview: true } })])
    quizzes.push({
      blockId: b.id, sessionNumber: s.number, lessonOpen: s.open, titleEn: b.titleEn, titleAr: b.titleAr, kind: data.kind, allowPaper: data.allowPaper && data.kind === 'FINAL',
      needsOpen: needsInstructorOpen(data), open: !!win?.open, closesAt: win?.closesAt ?? null, passMark: data.passMark,
      toReview: atts.filter((a) => a.status === 'SUBMITTED').map((a) => a.id),
      results: students.map((st) => {
        const mine = atts.filter((a) => a.studentId === st.studentId)
        return { studentId: st.studentId, tries: mine.filter((a) => !a.paper).length, paper: mine.some((a) => a.paper), inProgress: mine.some((a) => a.status === 'IN_PROGRESS'), waiting: mine.some((a) => a.status === 'SUBMITTED'), reviewId: mine.find((a) => a.status === 'SUBMITTED')?.id ?? null, result: quizScore(mine.filter((a) => a.status === 'GRADED'), data.scoring) }
      }),
    })
  }
  return { quizzes, students: students.map((s) => ({ id: s.studentId, name: `${s.student.firstName} ${s.student.lastName}`.trim() })) }
}

export async function setQuizWindow(user: { id: string; role: string; campusId?: string | null }, groupId: string, blockId: string, open: boolean, closesAt: Date | null): Promise<Outcome> {
  if (!(await canManageGroupLessons(user, groupId))) return fail('FORBIDDEN', 'Not your group')
  if (!(await loadQuizBlock(blockId))) return fail('NOT_FOUND', 'Quiz not found')
  await prisma.quizWindow.upsert({
    where: { classSectionId_blockId: { classSectionId: groupId, blockId } },
    create: { classSectionId: groupId, blockId, open, closesAt, byUserId: user.id },
    update: { open, closesAt, byUserId: user.id },
  })
  if (!open) await finishExpired({ classSectionId: groupId, blockId }) // nothing new; running tries end at their deadline
  return { ok: true }
}

/** Full attempt for the instructor (questions with answers + the student's answers). */
export async function staffAttempt(user: { id: string; role: string; campusId?: string | null }, attemptId: string) {
  const a = await prisma.quizAttempt.findUnique({ where: { id: attemptId } })
  if (!a || !(await canManageGroupLessons(user, a.classSectionId))) return null
  const st = await prisma.student.findUnique({ where: { id: a.studentId }, select: { firstName: true, lastName: true } })
  return { ...a, studentName: `${st?.firstName ?? ''} ${st?.lastName ?? ''}`.trim(), scanFiles: ((a.scanFiles as { originalName?: string }[] | null) ?? []).map((f, i) => ({ name: f.originalName ?? `scan ${i + 1}`, url: `/api/quizzes/scan/${a.id}?i=${i}` })) }
}

/** Instructor confirms written-code answers (points per question) and/or adds feedback. */
export async function reviewAttempt(user: { id: string; role: string; campusId?: string | null }, attemptId: string, points: Record<string, number>, feedback: string | null): Promise<Outcome<{ score: number }>> {
  const a = await prisma.quizAttempt.findUnique({ where: { id: attemptId } })
  if (!a) return fail('NOT_FOUND', 'Attempt not found')
  if (!(await canManageGroupLessons(user, a.classSectionId))) return fail('FORBIDDEN', 'Not your group')
  if (a.status === 'IN_PROGRESS') return fail('BAD_STATUS', 'Still running')
  const qs = (a.questions as unknown as QuizQuestion[]) ?? []
  const detail = ((a.detail as unknown as QuizResult[]) ?? []).map((d) => {
    const q = qs.find((x) => x.id === d.id)
    if (!q || points?.[d.id] === undefined) return d
    const p = Math.max(0, Math.min(q.points, Number(points[d.id]) || 0))
    return { ...d, points: p, correct: p === q.points, review: false }
  })
  if (detail.some((d) => d.review)) return fail('INVALID', 'Give points to every written-code answer')
  const score = Math.round(detail.reduce((s, d) => s + d.points, 0) * 100) / 100
  await prisma.quizAttempt.update({ where: { id: a.id }, data: { detail: detail as unknown as Prisma.InputJsonValue, score, manualScore: score, needsReview: false, status: 'GRADED', feedback: feedback?.trim().slice(0, 5000) || null, gradedById: user.id, gradedAt: new Date() } })
  return { ok: true, value: { score } }
}

/** Paper exam: the instructor types the score and attaches the scan (private files, uploaded to quizScanFolder). */
export async function paperResult(user: { id: string; role: string; campusId?: string | null }, groupId: string, blockId: string, input: { studentId: string; score: number; maxScore: number; scanFiles: { publicId: string; resourceType: 'image' | 'video' | 'raw'; format?: string; originalName?: string }[]; feedback?: string | null }, scanFolderPrefix: string): Promise<Outcome<{ id: string }>> {
  if (!(await canManageGroupLessons(user, groupId))) return fail('FORBIDDEN', 'Not your group')
  const qb = await loadQuizBlock(blockId)
  if (!qb) return fail('NOT_FOUND', 'Quiz not found')
  if (!qb.data.allowPaper) return fail('INVALID', 'This quiz is not done on paper')
  if (!(input.maxScore > 0) || input.score < 0 || input.score > input.maxScore) return fail('INVALID', 'The score must be between 0 and the maximum')
  if (input.scanFiles.some((f) => !f.publicId.startsWith(scanFolderPrefix))) return fail('INVALID', 'Scan not found')
  const enr = await prisma.studentEnrollment.count({ where: { classSectionId: groupId, studentId: input.studentId } })
  if (!enr) return fail('NOT_FOUND', 'Student is not in this group')
  const existing = await prisma.quizAttempt.findFirst({ where: { blockId, classSectionId: groupId, studentId: input.studentId, paper: true } })
  const data = {
    status: 'GRADED', score: input.score, maxScore: input.maxScore, manualScore: input.score, scanFiles: input.scanFiles as unknown as Prisma.InputJsonValue,
    feedback: input.feedback?.trim().slice(0, 5000) || null, gradedById: user.id, gradedAt: new Date(), submittedAt: new Date(),
  }
  const row = existing
    ? await prisma.quizAttempt.update({ where: { id: existing.id }, data })
    : await prisma.quizAttempt.create({ data: { ...data, blockId, sessionId: qb.b.sessionId, classSectionId: groupId, studentId: input.studentId, paper: true, attemptNo: 0, questions: [] } })
  return { ok: true, value: { id: row.id } }
}

export async function quizAnalysis(groupId: string | null, blockId: string) {
  const atts = await prisma.quizAttempt.findMany({ where: { blockId, ...(groupId ? { classSectionId: groupId } : {}), paper: false, status: { not: 'IN_PROGRESS' } }, select: { questions: true, answers: true, detail: true } })
  return itemAnalysis(atts.map((a) => ({ questions: (a.questions as unknown as QuizQuestion[]) ?? [], answers: (a.answers as Record<string, QuizAnswer>) ?? {}, detail: (a.detail as unknown as QuizResult[]) ?? [] })))
}

/** Level result: average % of session quizzes ("task") and the final exam % ("MCQ") in this level's groups. */
export async function quizLevelScores(studentId: string, levelId: string): Promise<{ task: number | null; mcq: number | null }> {
  const groups = await prisma.classSection.findMany({ where: { levelId, enrollments: { some: { studentId } } }, select: { id: true } })
  const atts = await prisma.quizAttempt.findMany({ where: { studentId, classSectionId: { in: groups.map((g) => g.id) }, status: 'GRADED' }, select: { blockId: true, score: true, maxScore: true, createdAt: true } })
  if (!atts.length) return { task: null, mcq: null }
  const blocks = await prisma.curriculumBlock.findMany({ where: { id: { in: [...new Set(atts.map((a) => a.blockId))] } }, select: { id: true, data: true } })
  const session: number[] = [], final: number[] = []
  for (const b of blocks) {
    const data = parseQuiz(b.data)
    if (!data) continue
    const r = quizScore(atts.filter((a) => a.blockId === b.id), data.scoring)
    if (r) (data.kind === 'FINAL' ? final : session).push(r.percent)
  }
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : null)
  return { task: avg(session), mcq: avg(final) }
}
