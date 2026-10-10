/**
 * LMS L3 — assignments: hand-in, grading, due dates, reminders, level scores (docs/plan-learning-platform.md §2 L3).
 * Server-only. Pure rules live in ./rules.ts.
 *
 * - An assignment = an ASSIGNMENT block of the group's curriculum version. It is open for a student when its
 *   lesson is open (same rules as the lessons, lib/lms/unlock.ts).
 * - Due date: the group's own date (AssignmentDue) or the start of the NEXT session; a student with an excused
 *   absence on the lesson's day gets `excuseExtensionDays` more.
 * - Policy (late rule, penalty, resubmission, parents handing in for young children): company > level > group,
 *   AppSetting `lms.assignments`.
 * - Files are private Cloudinary uploads in the student's own folder (`<base>/submissions/<studentId>`); they open
 *   through /api/assignments/files (access checked).
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { getBaseUploadFolder } from '@/lib/cloudinary'
import { visibleTo } from '@/lib/curriculum/blocks'
import { groupLessons, studentLessonGroups, studentLessonAccess, studentInGroup, canManageGroupLessons } from '@/lib/lms/engine'
import { getLmsSettings } from '@/lib/lms/settings'
import { ageOn, cairoYmd } from '@/lib/dates/cairo'
import {
  assignmentDataSchema, canSubmit, finalScore, gradeQuestions, manualKinds, manualMax, penaltyFor, percentOf,
  questionsMax, resolvePolicy, rubricScore, stripForStudent, totalMax, POLICY_DEFAULTS,
  type AssignmentData, type AssignmentPolicy, type Answers, type SubmitCheck,
} from './rules'

export interface Outcome<T = undefined> { ok: boolean; code?: string; message?: string; value?: T }
const fail = (code: string, message: string) => ({ ok: false, code, message })
const DAY = 86_400_000

// ───────────────────────── policy settings ─────────────────────────

export interface PolicySettings { company: AssignmentPolicy; levels: Record<string, Partial<AssignmentPolicy>>; groups: Record<string, Partial<AssignmentPolicy>> }
export const getPolicySettings = () => getSetting<PolicySettings>('lms.assignments', { company: POLICY_DEFAULTS, levels: {}, groups: {} })
export const savePolicySettings = (v: PolicySettings, userId: string) => setSetting('lms.assignments', v, userId)

export async function policyForGroup(groupId: string): Promise<AssignmentPolicy> {
  const [ps, g] = await Promise.all([getPolicySettings(), prisma.classSection.findUnique({ where: { id: groupId }, select: { levelId: true } })])
  return resolvePolicy(ps.company, g?.levelId ? ps.levels?.[g.levelId] : null, ps.groups?.[groupId])
}

export const submissionsFolder = (studentId: string) => `${getBaseUploadFolder()}/submissions/${studentId}`

// ───────────────────────── reading assignments ─────────────────────────

export function parseAssignment(data: unknown): AssignmentData | null {
  const r = assignmentDataSchema.safeParse(data ?? {})
  return r.success ? r.data : null
}

interface GroupAssignment {
  blockId: string; sessionId: string; sessionNumber: number; open: boolean
  titleEn: string | null; titleAr: string | null; sessionTitleEn: string; sessionTitleAr: string
  data: AssignmentData; dueAt: Date | null
}

/** Every assignment of a group's curriculum (with open state for the student, and the group due date). */
export async function groupAssignments(groupId: string, opts: { studentId?: string } = {}): Promise<GroupAssignment[]> {
  const gl = await groupLessons(groupId, opts)
  if (!gl?.edition) return []
  const blocks = await prisma.curriculumBlock.findMany({
    where: { sessionId: { in: gl.sessions.map((s) => s.id) }, type: 'ASSIGNMENT' },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  const dues = await prisma.assignmentDue.findMany({ where: { classSectionId: groupId, blockId: { in: blocks.map((b) => b.id) } } })
  const out: GroupAssignment[] = []
  for (const b of blocks) {
    if (!visibleTo(b.audience, 'STUDENT')) continue
    const data = parseAssignment(b.data)
    if (!data) continue
    const s = gl.sessions.find((x) => x.id === b.sessionId)!
    const next = gl.sessions.find((x) => x.number === s.number + 1)
    const own = dues.find((d) => d.blockId === b.id)?.dueAt ?? null
    out.push({
      blockId: b.id, sessionId: s.id, sessionNumber: s.number, open: s.open,
      titleEn: b.titleEn, titleAr: b.titleAr, sessionTitleEn: s.titleEn, sessionTitleAr: s.titleAr, data,
      dueAt: own ?? (next?.scheduledAt ? new Date(next.scheduledAt) : null),
    })
  }
  return out.sort((a, b) => a.sessionNumber - b.sessionNumber)
}

/** The student's own due date: + extension days when the lesson's day was an excused absence. */
async function studentDue(groupId: string, studentId: string, a: GroupAssignment, policy: AssignmentPolicy): Promise<Date | null> {
  if (!a.dueAt || !policy.excuseExtensionDays) return a.dueAt
  const gl = await groupLessons(groupId)
  const when = gl?.sessions.find((s) => s.number === a.sessionNumber)?.scheduledAt
  if (!when) return a.dueAt
  const day = new Date(`${new Date(when).toISOString().slice(0, 10)}T00:00:00.000Z`)
  const excused = await prisma.enrollmentAttendanceRecord.count({
    where: { attendanceDate: day, status: 'EXCUSED', studentEnrollment: { studentId, classSectionId: groupId } },
  })
  return excused ? new Date(a.dueAt.getTime() + policy.excuseExtensionDays * DAY) : a.dueAt
}

const submissionView = (s: Prisma.AssignmentSubmissionGetPayload<object> | null) => s && {
  id: s.id, status: s.status, attempt: s.attempt, text: s.text, links: s.links, answers: s.answers, inClass: s.inClass,
  files: ((s.files as { publicId: string; resourceType: string; format?: string; originalName?: string; bytes?: number }[] | null) ?? []).map((f, i) => ({ ...f, url: `/api/assignments/files/${s.id}?i=${i}` })),
  autoScore: s.autoScore, autoDetail: s.status === 'GRADED' ? s.autoDetail : null, score: s.score, maxScore: s.maxScore,
  rubricScores: s.rubricScores, feedback: s.feedback, late: s.late, latePenaltyPct: s.latePenaltyPct,
  submittedAt: s.submittedAt, gradedAt: s.gradedAt, updatedAt: s.updatedAt,
}

/** "My assignments": every open assignment of the student's groups with status, due date and grade. */
export async function studentAssignments(studentId: string) {
  const groupIds = await studentLessonGroups(studentId)
  const out = []
  for (const gid of groupIds) {
    const [list, policy, g] = await Promise.all([
      groupAssignments(gid, { studentId }), policyForGroup(gid),
      prisma.classSection.findUnique({ where: { id: gid }, select: { className: true, sectionName: true, level: { select: { name: true, subject: { select: { name: true } } } } } }),
    ])
    const open = list.filter((a) => a.open)
    if (!open.length) continue
    const subs = await prisma.assignmentSubmission.findMany({ where: { studentId, classSectionId: gid, blockId: { in: open.map((a) => a.blockId) } } })
    const items = []
    for (const a of open) {
      const sub = subs.find((s) => s.blockId === a.blockId) ?? null
      items.push({
        blockId: a.blockId, sessionId: a.sessionId, sessionNumber: a.sessionNumber, titleEn: a.titleEn, titleAr: a.titleAr,
        sessionTitleEn: a.sessionTitleEn, sessionTitleAr: a.sessionTitleAr, finalProject: a.data.finalProject,
        dueAt: await studentDue(gid, studentId, a, policy), maxScore: totalMax(a.data),
        status: sub?.status ?? 'TODO', score: sub?.status === 'GRADED' ? sub.score : null, late: sub?.late ?? false,
        feedback: sub?.status === 'GRADED' || sub?.status === 'RETURNED' ? sub.feedback : null,
      })
    }
    out.push({ group: { id: gid, label: `${g?.className ?? ''} ${g?.sectionName ?? ''}`.trim(), courseName: g?.level?.subject?.name ?? '', levelName: g?.level?.name ?? '' }, items })
  }
  return out
}

/** One assignment for the student (or a parent): data without answers, their submission, due, what they may do. */
export async function studentAssignment(studentId: string, groupId: string, blockId: string) {
  const b = await prisma.curriculumBlock.findUnique({ where: { id: blockId } })
  if (!b || b.type !== 'ASSIGNMENT' || !visibleTo(b.audience, 'STUDENT')) return fail('NOT_FOUND', 'Assignment not found')
  const access = await studentLessonAccess(studentId, groupId, b.sessionId)
  if (!access.ok) return fail(access.code!, access.message!)
  const data = parseAssignment(b.data)
  if (!data) return fail('NOT_FOUND', 'Assignment not found')
  const a = (await groupAssignments(groupId, { studentId })).find((x) => x.blockId === blockId)!
  const [policy, sub, student, settings] = await Promise.all([
    policyForGroup(groupId),
    prisma.assignmentSubmission.findUnique({ where: { blockId_studentId_classSectionId: { blockId, studentId, classSectionId: groupId } } }),
    prisma.student.findUnique({ where: { id: studentId }, select: { dateOfBirth: true } }),
    getLmsSettings(),
  ])
  const dueAt = await studentDue(groupId, studentId, a, policy)
  const check = canSubmit({ now: new Date(), dueAt, policy, status: sub?.status ?? null, attempt: sub?.attempt ?? 0 })
  const age = student?.dateOfBirth ? ageOn(student.dateOfBirth, cairoYmd()) : null
  return {
    ok: true,
    value: {
      blockId, sessionId: b.sessionId, groupId, titleEn: b.titleEn, titleAr: b.titleAr,
      assignment: { ...stripForStudent(data), maxScore: totalMax(data), questionsMax: questionsMax(data.questions), manualMax: manualMax(data) },
      submission: submissionView(sub), dueAt, policy, canSubmit: check,
      parentMaySubmit: policy.parentCanSubmit && age !== null && age <= settings.kidModeMaxAge,
      uploadFolder: submissionsFolder(studentId),
    },
  }
}

// ───────────────────────── handing in ─────────────────────────

export interface HandIn {
  text?: string | null
  links?: string[]
  files?: { publicId: string; resourceType: 'image' | 'video' | 'raw'; format?: string; bytes?: number; originalName?: string }[]
  answers?: Answers
}

/**
 * Saves a draft (submit = false) or hands in (submit = true). `byUserId` = the student, or a parent for a young child.
 * Auto-graded questions are scored on the server; AUTO with nothing to look at = graded at once.
 */
export async function saveSubmission(studentId: string, groupId: string, blockId: string, input: HandIn, submit: boolean, byUserId: string): Promise<Outcome<{ status: string; score: number | null }>> {
  const loaded = await studentAssignment(studentId, groupId, blockId)
  if (!loaded.ok) return fail((loaded as Outcome).code!, (loaded as Outcome).message!)
  const ctx = (loaded as unknown as { value: { sessionId: string; canSubmit: SubmitCheck; policy: AssignmentPolicy } }).value
  const b = await prisma.curriculumBlock.findUnique({ where: { id: blockId } })
  const data = parseAssignment(b!.data)!
  const kinds = manualKinds(data.kinds)

  // only what this assignment accepts; files only from the student's own private folder
  const folder = submissionsFolder(studentId)
  const files = (input.files ?? []).slice(0, 10)
  if (files.length && !kinds.some((k) => k === 'FILE' || k === 'PHOTO' || k === 'VIDEO')) return fail('INVALID', 'This assignment does not take files')
  if (files.some((f) => !f.publicId.startsWith(`${folder}/`))) return fail('INVALID', 'File not found')
  const links = (input.links ?? []).map((l) => l.trim()).filter(Boolean).slice(0, 5)
  if (links.length && !kinds.includes('LINK')) return fail('INVALID', 'This assignment does not take links')
  if (links.some((l) => !/^https:\/\/[^\s]+$/.test(l))) return fail('INVALID', 'Links must start with https://')
  const text = input.text?.slice(0, 20000) ?? null
  if (text && !kinds.includes('TEXT')) return fail('INVALID', 'This assignment does not take text')
  const answers = data.questions.length ? (input.answers ?? {}) : null

  const existing = await prisma.assignmentSubmission.findUnique({ where: { blockId_studentId_classSectionId: { blockId, studentId, classSectionId: groupId } } })
  if (existing && (existing.status === 'SUBMITTED' || existing.status === 'GRADED') && !submit) return fail('LOCKED', 'Already handed in')
  const base = { text, links: links as Prisma.InputJsonValue, files: files as unknown as Prisma.InputJsonValue, answers: (answers ?? undefined) as Prisma.InputJsonValue | undefined }

  if (!submit) {
    await prisma.assignmentSubmission.upsert({
      where: { blockId_studentId_classSectionId: { blockId, studentId, classSectionId: groupId } },
      create: { blockId, sessionId: ctx.sessionId, classSectionId: groupId, studentId, status: 'DRAFT', ...base },
      update: { ...base, ...(existing?.status === 'RETURNED' ? {} : { status: 'DRAFT' }) },
    })
    return { ok: true, value: { status: existing?.status === 'RETURNED' ? 'RETURNED' : 'DRAFT', score: null } }
  }

  if (!ctx.canSubmit.ok) return fail(ctx.canSubmit.code!, ctx.canSubmit.message!)
  const hasWork = !!text || links.length > 0 || files.length > 0 || (answers && Object.keys(answers).length > 0)
  if (!hasWork && !(kinds.length === 1 && kinds[0] === 'IN_CLASS')) return fail('EMPTY', 'Nothing to hand in yet')

  const policy = ctx.policy
  const late = ctx.canSubmit.late && policy.late !== 'ALLOWED'
  const pen = penaltyFor(ctx.canSubmit.late, policy)
  const auto = data.questions.length ? gradeQuestions(data.questions, answers ?? {}) : null
  const onlyAuto = data.gradingMode === 'AUTO' && kinds.length === 0
  const max = totalMax(data)
  const status = onlyAuto ? 'GRADED' : 'SUBMITTED'
  const score = onlyAuto ? finalScore(auto?.score ?? 0, 0, pen) : null
  const history = [
    ...(((existing?.history as unknown[]) ?? []) as unknown[]),
    ...(existing && existing.status !== 'DRAFT' ? [{ attempt: existing.attempt, status: existing.status, text: existing.text, links: existing.links, files: existing.files, answers: existing.answers, score: existing.score, feedback: existing.feedback, submittedAt: existing.submittedAt }] : []),
  ].slice(-10)

  const saved = await prisma.assignmentSubmission.upsert({
    where: { blockId_studentId_classSectionId: { blockId, studentId, classSectionId: groupId } },
    create: {
      blockId, sessionId: ctx.sessionId, classSectionId: groupId, studentId, ...base, status, attempt: 1,
      autoScore: auto?.score ?? null, autoDetail: (auto?.detail ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      score, maxScore: max, late, latePenaltyPct: pen || null, submittedAt: new Date(), submittedByUserId: byUserId,
      ...(onlyAuto ? { gradedAt: new Date() } : {}),
    },
    update: {
      ...base, status, attempt: { increment: 1 }, autoScore: auto?.score ?? null, autoDetail: (auto?.detail ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      score, maxScore: max, late, latePenaltyPct: pen || null, submittedAt: new Date(), submittedByUserId: byUserId,
      rubricScores: Prisma.DbNull, feedback: onlyAuto ? null : existing?.feedback ?? null, gradedAt: onlyAuto ? new Date() : null, gradedById: null,
      history: history as Prisma.InputJsonValue,
    },
  })
  // the lesson item counts as done once handed in
  await prisma.lessonProgress.upsert({
    where: { studentId_blockId: { studentId, blockId } },
    create: { studentId, blockId, sessionId: ctx.sessionId, classSectionId: groupId },
    update: {},
  }).catch(() => undefined)
  return { ok: true, value: { status: saved.status, score: saved.score } }
}

// ───────────────────────── staff: gradebook & grading ─────────────────────────

/** Students × assignments of one group (only assignments whose lesson is open for the group). */
export async function gradebook(groupId: string) {
  const [list, enrollments, policy] = await Promise.all([
    groupAssignments(groupId),
    prisma.studentEnrollment.findMany({
      where: { classSectionId: groupId, status: 'ACTIVE' },
      select: { studentId: true, student: { select: { firstName: true, lastName: true, registrationNumber: true } } },
      orderBy: { student: { firstName: 'asc' } },
    }),
    policyForGroup(groupId),
  ])
  const assignments = list.filter((a) => a.open || a.sessionNumber <= (list.find((x) => x.open)?.sessionNumber ?? 0))
  const subs = await prisma.assignmentSubmission.findMany({
    where: { classSectionId: groupId, blockId: { in: assignments.map((a) => a.blockId) } },
    select: { id: true, blockId: true, studentId: true, status: true, score: true, maxScore: true, late: true, submittedAt: true, autoScore: true, inClass: true },
  })
  return {
    policy,
    assignments: assignments.map((a) => ({
      blockId: a.blockId, sessionNumber: a.sessionNumber, titleEn: a.titleEn, titleAr: a.titleAr, open: a.open,
      dueAt: a.dueAt, maxScore: totalMax(a.data), finalProject: a.data.finalProject, kinds: a.data.kinds,
      gradingMode: a.data.gradingMode, scale: a.data.scale,
      handedIn: subs.filter((s) => s.blockId === a.blockId && s.status !== 'DRAFT').length,
      toGrade: subs.filter((s) => s.blockId === a.blockId && s.status === 'SUBMITTED').length,
    })),
    students: enrollments.map((e) => ({ id: e.studentId, name: `${e.student.firstName} ${e.student.lastName}`.trim(), reg: e.student.registrationNumber })),
    cells: subs,
  }
}

/** Full submission for the person grading (with the correct answers and auto detail). */
export async function staffSubmission(submissionId: string) {
  const s = await prisma.assignmentSubmission.findUnique({ where: { id: submissionId } })
  if (!s) return null
  const b = await prisma.curriculumBlock.findUnique({ where: { id: s.blockId } })
  const data = parseAssignment(b?.data)
  const student = await prisma.student.findUnique({ where: { id: s.studentId }, select: { firstName: true, lastName: true, registrationNumber: true } })
  return {
    submission: { ...submissionView(s), autoDetail: s.autoDetail, history: s.history, submittedByUserId: s.submittedByUserId },
    assignment: data ? { ...data, maxScore: totalMax(data), questionsMax: questionsMax(data.questions), manualMax: manualMax(data) } : null,
    titleEn: b?.titleEn ?? null, titleAr: b?.titleAr ?? null, student, classSectionId: s.classSectionId, studentId: s.studentId,
  }
}

export interface GradeInput {
  action: 'grade' | 'return'
  points?: number | null
  stars?: number | null
  rubricPicks?: Record<string, number>
  /** instructor's change to the automatic score (needs a reason) */
  autoOverride?: number | null
  overrideReason?: string | null
  feedback?: string | null
}

export async function gradeSubmission(user: { id: string; role: string; campusId?: string | null }, submissionId: string, input: GradeInput): Promise<Outcome<{ score: number | null; status: string }>> {
  const s = await prisma.assignmentSubmission.findUnique({ where: { id: submissionId } })
  if (!s) return fail('NOT_FOUND', 'Submission not found')
  if (!(await canManageGroupLessons(user, s.classSectionId))) return fail('FORBIDDEN', 'Not your group')
  if (s.status === 'DRAFT') return fail('BAD_STATUS', 'Not handed in yet')
  const b = await prisma.curriculumBlock.findUnique({ where: { id: s.blockId } })
  const data = parseAssignment(b?.data)
  if (!data) return fail('NOT_FOUND', 'Assignment not found')
  const feedback = input.feedback?.trim().slice(0, 5000) || null

  if (input.action === 'return') {
    if (!feedback) return fail('INVALID', 'Write what needs to change')
    await prisma.assignmentSubmission.update({ where: { id: s.id }, data: { status: 'RETURNED', feedback, gradedAt: new Date(), gradedById: user.id, score: null } })
    await notifyGraded(s.studentId, b?.titleEn || 'Homework', 'returned')
    return { ok: true, value: { score: null, status: 'RETURNED' } }
  }

  let manual = 0
  let rubricScores: Prisma.InputJsonValue | undefined
  if (manualKinds(data.kinds).length) {
    if (data.scale === 'RUBRIC') {
      const r = rubricScore(data.rubric?.criteria ?? [], input.rubricPicks ?? {})
      if (!r.ok) return fail('INVALID', 'Choose a level for every rubric line')
      manual = r.points
      rubricScores = input.rubricPicks as Prisma.InputJsonValue
    } else if (data.scale === 'STARS') {
      const st = Number(input.stars)
      if (!Number.isInteger(st) || st < 0 || st > 3) return fail('INVALID', 'Give 0 to 3 stars')
      manual = st
    } else {
      const p = Number(input.points)
      if (!Number.isFinite(p) || p < 0 || p > data.maxPoints) return fail('INVALID', `Points must be 0 to ${data.maxPoints}`)
      manual = p
    }
  }
  let auto = s.autoScore ?? 0
  let autoDetail = s.autoDetail as Prisma.InputJsonValue | undefined
  if (input.autoOverride !== undefined && input.autoOverride !== null && input.autoOverride !== s.autoScore) {
    if (!input.overrideReason?.trim()) return fail('INVALID', 'Write why the automatic score is changed')
    const qmax = questionsMax(data.questions)
    if (input.autoOverride < 0 || input.autoOverride > qmax) return fail('INVALID', `Question points must be 0 to ${qmax}`)
    auto = input.autoOverride
    autoDetail = { ...(typeof s.autoDetail === 'object' && s.autoDetail ? { items: s.autoDetail } : {}), override: { from: s.autoScore, to: auto, reason: input.overrideReason.trim().slice(0, 500), by: user.id, at: new Date().toISOString() } } as Prisma.InputJsonValue
  }
  const score = finalScore(auto, manual, s.latePenaltyPct ?? 0)
  await prisma.assignmentSubmission.update({
    where: { id: s.id },
    data: { status: 'GRADED', score, maxScore: totalMax(data), autoScore: auto, autoDetail, rubricScores, feedback, gradedAt: new Date(), gradedById: user.id },
  })
  await notifyGraded(s.studentId, b?.titleEn || 'Homework', `graded: ${score} / ${totalMax(data)}`)
  return { ok: true, value: { score, status: 'GRADED' } }
}

async function notifyGraded(studentId: string, title: string, what: string) {
  try {
    const { notifyFamilies } = await import('@/lib/notifications/events')
    await notifyFamilies([studentId], 'ASSIGNMENT_GRADED', (st) => ({ title: 'Homework', message: `${st.firstName}: "${title}" ${what}.`, relatedId: null }), { includeStudent: true })
  } catch (err) { console.error('[ASSIGNMENT_NOTIFY]', err) }
}

/** "Done in class": tick (optionally with full marks) for several students at once. */
export async function markInClass(user: { id: string; role: string; campusId?: string | null }, groupId: string, blockId: string, studentIds: string[], fullMarks: boolean): Promise<Outcome<{ count: number }>> {
  if (!(await canManageGroupLessons(user, groupId))) return fail('FORBIDDEN', 'Not your group')
  const b = await prisma.curriculumBlock.findUnique({ where: { id: blockId } })
  const data = parseAssignment(b?.data)
  if (!b || !data) return fail('NOT_FOUND', 'Assignment not found')
  let count = 0
  for (const studentId of studentIds.slice(0, 200)) {
    if (!(await studentInGroup(studentId, groupId))) continue
    const max = totalMax(data)
    const graded = fullMarks && !data.questions.length
    await prisma.assignmentSubmission.upsert({
      where: { blockId_studentId_classSectionId: { blockId, studentId, classSectionId: groupId } },
      create: { blockId, sessionId: b.sessionId, classSectionId: groupId, studentId, status: graded ? 'GRADED' : 'SUBMITTED', attempt: 1, inClass: true, maxScore: max, score: graded ? manualMax(data) : null, submittedAt: new Date(), submittedByUserId: user.id, ...(graded ? { gradedAt: new Date(), gradedById: user.id } : {}) },
      update: { inClass: true, status: graded ? 'GRADED' : 'SUBMITTED', ...(graded ? { score: manualMax(data), gradedAt: new Date(), gradedById: user.id } : {}) },
    })
    await prisma.lessonProgress.upsert({ where: { studentId_blockId: { studentId, blockId } }, create: { studentId, blockId, sessionId: b.sessionId, classSectionId: groupId }, update: {} }).catch(() => undefined)
    count++
  }
  return { ok: true, value: { count } }
}

export async function setGroupDue(groupId: string, blockId: string, dueAt: Date | null, userId: string): Promise<Outcome> {
  if (!dueAt) { await prisma.assignmentDue.deleteMany({ where: { classSectionId: groupId, blockId } }); return { ok: true } }
  await prisma.assignmentDue.upsert({
    where: { classSectionId_blockId: { classSectionId: groupId, blockId } },
    create: { classSectionId: groupId, blockId, dueAt, setById: userId },
    update: { dueAt, setById: userId },
  })
  return { ok: true }
}

// ───────────────────────── level result: homework / project from the LMS ─────────────────────────

/** Average % of the student's GRADED assignments in every group of this level (homework = not final project). */
export async function lmsLevelScores(studentId: string, levelId: string): Promise<{ homework: number | null; project: number | null; graded: number }> {
  const groups = await prisma.classSection.findMany({ where: { levelId, enrollments: { some: { studentId } } }, select: { id: true } })
  const subs = await prisma.assignmentSubmission.findMany({
    where: { studentId, classSectionId: { in: groups.map((g) => g.id) }, status: 'GRADED' },
    select: { blockId: true, score: true, maxScore: true },
  })
  if (!subs.length) return { homework: null, project: null, graded: 0 }
  const blocks = await prisma.curriculumBlock.findMany({ where: { id: { in: subs.map((s) => s.blockId) } }, select: { id: true, data: true } })
  const isProject = (id: string) => !!(blocks.find((b) => b.id === id)?.data as { finalProject?: boolean } | null)?.finalProject
  const avg = (rows: typeof subs) => {
    const p = rows.map((r) => percentOf(r.score, r.maxScore)).filter((x): x is number => x !== null)
    return p.length ? Math.round((p.reduce((a, b) => a + b, 0) / p.length) * 100) / 100 : null
  }
  return { homework: avg(subs.filter((s) => !isProject(s.blockId))), project: avg(subs.filter((s) => isProject(s.blockId))), graded: subs.length }
}

// ───────────────────────── daily job: new / due soon / waiting to be graded ─────────────────────────

export async function assignmentReminders(now = new Date()) {
  const out = { newSent: 0, dueSent: 0, ungradedSent: 0 }
  const { notifyFamilies, notifyUsers } = await import('@/lib/notifications/events')
  const groups = await prisma.classSection.findMany({ where: { status: 'ACTIVE', isActive: true, levelId: { not: null }, curriculumEditionId: { not: null } }, select: { id: true } })
  for (const g of groups) {
    const list = (await groupAssignments(g.id)).filter((a) => a.open)
    if (!list.length) continue
    const students = (await prisma.studentEnrollment.findMany({ where: { classSectionId: g.id, status: 'ACTIVE' }, select: { studentId: true } })).map((e) => e.studentId)
    for (const a of list) {
      const title = a.titleEn || a.sessionTitleEn || 'Homework'
      const notice = async (kind: string, studentId = '') => {
        try { await prisma.assignmentNotice.create({ data: { classSectionId: g.id, blockId: a.blockId, kind, studentId } }); return true } catch { return false }
      }
      if (students.length && (await notice('NEW'))) {
        const due = a.dueAt ? ` Due ${a.dueAt.toISOString().slice(0, 10)}.` : ''
        out.newSent += await notifyFamilies(students, 'ASSIGNMENT_NEW', (st) => ({ title: 'New homework', message: `${st.firstName}: "${title}".${due}`, relatedId: null }), { includeStudent: true })
      }
      if (a.dueAt && a.dueAt.getTime() > now.getTime() && a.dueAt.getTime() - now.getTime() <= DAY) {
        const handed = new Set((await prisma.assignmentSubmission.findMany({ where: { classSectionId: g.id, blockId: a.blockId, status: { not: 'DRAFT' } }, select: { studentId: true } })).map((s) => s.studentId))
        for (const sid of students.filter((x) => !handed.has(x))) {
          if (await notice('DUE_SOON', sid)) out.dueSent += await notifyFamilies([sid], 'ASSIGNMENT_DUE', (st) => ({ title: 'Homework due soon', message: `${st.firstName}: "${title}" is due ${a.dueAt!.toISOString().slice(0, 10)}.`, relatedId: null }), { includeStudent: true })
        }
      }
    }
    // instructor: hand-ins waiting more than 48 h
    const waiting = await prisma.assignmentSubmission.count({ where: { classSectionId: g.id, status: 'SUBMITTED', submittedAt: { lt: new Date(now.getTime() - 2 * DAY) } } })
    if (waiting) {
      const offering = await prisma.subjectOffering.findFirst({ where: { classSectionId: g.id, teacherId: { not: null } }, orderBy: { createdAt: 'desc' }, select: { teacher: { select: { userId: true } } } })
      const day = now.toISOString().slice(0, 10)
      if (offering?.teacher?.userId) {
        const fresh = await prisma.assignmentNotice.create({ data: { classSectionId: g.id, blockId: `ungraded-${day}`, kind: 'UNGRADED', studentId: '' } }).then(() => true).catch(() => false)
        if (fresh) out.ungradedSent += await notifyUsers([offering.teacher.userId], 'ASSIGNMENT_UNGRADED', { title: 'Homework to grade', message: `${waiting} hand-in(s) waiting more than 48 hours.`, relatedId: g.id })
      }
    }
  }
  return out
}
