/**
 * R1 session report (docs/plan-learning-platform.md §3 R1, owner decisions 2026-10-11). Server-only.
 *
 * - Made (DRAFT) when attendance of a group is saved for a date (and by the sweep for any held session that has none,
 *   e.g. QR attendance). Only while switched on in the settings (off by default).
 * - Parts read live when shown: what was done (curriculum session), attendance, previous homework (+ grade by the
 *   release rules), the session quiz, next homework. Stored: the instructor's extras (star, phrases, comment, group note).
 * - Sent by itself at `sendAt` (session end + N hours, at least 30 minutes after it was made) or by the instructor
 *   (MANUAL mode / "Send now"). After sending nobody edits it. Parents / students see SENT reports only.
 * - Who sees: admins all; branch manager + secretary own branch (secretary read-only); instructor own groups and
 *   groups covered as a substitute; parent own children; student own.
 */

import { canSeeGroup, groupWhere, requestPlaces } from '@/lib/places/server'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { campusScope } from '@/lib/academic/api-helpers'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { getTeacherByUserId, getTeacherClassSectionIds } from '@/lib/academic/teacher-scope'
import { occurrencesFor } from '@/lib/groups/occurrences'
import { cairoDateTimeToUtc, cairoToday } from '@/lib/dates/cairo'
import { canManageGroupLessons, groupLessons } from '@/lib/lms/engine'
import { groupAssignments, policyForGroup, visibility } from '@/lib/assignments/engine'
import { parseQuiz } from '@/lib/quizzes/engine'
import { notifyFamilies } from '@/lib/notifications/events'
import { studentViewer } from '@/lib/students/access'
import {
  SESSION_REPORT_DEFAULTS, DEFAULT_SESSION_MIN, cleanPhrases, computeSendAt, homeworkLine, missingPieces, quizLine,
  type SessionReportSettings,
} from './rules'

type User = { id: string; role: string; campusId?: string | null }
export interface Outcome<T = undefined> { ok: boolean; code?: string; message?: string; value?: T }
const fail = (code: string, message: string) => ({ ok: false, code, message })

const KEY = 'sessionReports.settings'
const DAY = 86_400_000
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const dateOnly = (s: string) => new Date(`${s}T00:00:00.000Z`)
const name = (p: { firstName: string; lastName: string } | null | undefined) => (p ? `${p.firstName} ${p.lastName}`.trim() : '')

export async function getSessionReportSettings(): Promise<SessionReportSettings> {
  const s = await getSetting<Partial<SessionReportSettings>>(KEY, {})
  return { ...SESSION_REPORT_DEFAULTS, ...s, phrases: s.phrases?.length ? s.phrases : SESSION_REPORT_DEFAULTS.phrases }
}
export const saveSessionReportSettings = (v: SessionReportSettings, userId: string) => setSetting(KEY, v, userId)

// ───────────────────────── who may see / edit ─────────────────────────

/** Staff who may read a group's session reports (secretaries of the branch included). */
export async function canViewGroupReports(user: User, groupId: string): Promise<boolean> {
  const role = user.role as Role
  if (!checkPermission(role, 'session_reports', 'read')) return false
  if (role === 'TEACHER') return canManageGroupLessons(user, groupId)
  return canSeeGroup(user, groupId)
}

/** Staff who may add extras and send (never secretaries — same as the LMS staff screens). */
export async function canEditGroupReports(user: User, groupId: string): Promise<boolean> {
  return checkPermission(user.role as Role, 'session_reports', 'update') && (await canManageGroupLessons(user, groupId))
}

// ───────────────────────── making a report ─────────────────────────

async function attendanceOf(groupId: string, date: string) {
  return prisma.enrollmentAttendanceRecord.findMany({
    where: { attendanceDate: dateOnly(date), studentEnrollment: { classSectionId: groupId } },
    select: { status: true, taughtByTeacherId: true, studentEnrollment: { select: { studentId: true } } },
  })
}

/** Creates the DRAFT report of a held session (no-op when off, when there is no attendance or when it exists). */
export async function ensureSessionReport(groupId: string, date: string, settings?: SessionReportSettings) {
  const s = settings ?? (await getSessionReportSettings())
  if (!s.enabled) return null
  const existing = await prisma.sessionReport.findUnique({ where: { classSectionId_sessionDate: { classSectionId: groupId, sessionDate: dateOnly(date) } } })
  if (existing) return existing
  const att = await attendanceOf(groupId, date)
  if (!att.length) return null
  const occ = (await occurrencesFor({ groupIds: [groupId] }, date, date))[0]
  const o = occ?.occurrences.find((x) => x.date === date)
  const sessionNumber = o?.sessionNumber ?? null
  let duration = DEFAULT_SESSION_MIN
  if (sessionNumber) {
    const gl = await groupLessons(groupId).catch(() => null)
    const cs = gl?.sessions.find((x) => x.number === gl.range.from - 1 + sessionNumber)
    if (cs?.durationMin) duration = cs.durationMin
  }
  const start = o?.time ? cairoDateTimeToUtc(date, o.time) : null
  const sessionEnd = start ? new Date(start.getTime() + duration * 60_000) : null
  const teacherId = att.find((a) => a.taughtByTeacherId)?.taughtByTeacherId ?? occ?.teacherId ?? null
  try {
    return await prisma.sessionReport.create({
      data: { classSectionId: groupId, sessionDate: dateOnly(date), sessionNumber, teacherId, sendAt: computeSendAt({ mode: s.mode, hours: s.hours, sessionEnd, now: new Date() }) },
    })
  } catch {
    // made at the same moment by another request (unique group + date)
    return prisma.sessionReport.findUnique({ where: { classSectionId_sessionDate: { classSectionId: groupId, sessionDate: dateOnly(date) } } })
  }
}

/** After attendance is saved — never breaks the save. */
export async function afterAttendanceForReport(groupId: string, date: string) {
  try {
    await ensureSessionReport(groupId, date.slice(0, 10))
  } catch (err) {
    console.error('[SESSION_REPORT_ENSURE]', err)
  }
}

// ───────────────────────── sending ─────────────────────────

async function groupLabel(groupId: string) {
  const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { className: true, sectionName: true } })
  return `${g?.className ?? ''} ${g?.sectionName ?? ''}`.trim()
}

/** DRAFT → SENT once (guarded), then the families get a notification. */
async function deliver(reportId: string, byUserId: string | null): Promise<boolean> {
  const done = await prisma.sessionReport.updateMany({ where: { id: reportId, status: 'DRAFT' }, data: { status: 'SENT', sentAt: new Date(), sentById: byUserId } })
  if (done.count !== 1) return false
  const r = await prisma.sessionReport.findUnique({ where: { id: reportId }, include: { students: { select: { studentId: true, star: true } } } })
  if (!r) return true
  const date = ymd(r.sessionDate)
  const ids = (await attendanceOf(r.classSectionId, date)).map((a) => a.studentEnrollment.studentId)
  const label = await groupLabel(r.classSectionId)
  const stars = new Set(r.students.filter((x) => x.star).map((x) => x.studentId))
  await notifyFamilies(ids, 'SESSION_REPORT', (st) => ({
    title: 'Session report',
    message: `${st.firstName}: the report of the ${label} session${r.sessionNumber ? ` ${r.sessionNumber}` : ''} (${date}) is ready.${stars.has(st.id) ? ' ⭐ Star of the session!' : ''}`,
    relatedId: r.id,
  }), { includeStudent: true })
  return true
}

export async function sendNow(user: User, reportId: string): Promise<Outcome> {
  const r = await prisma.sessionReport.findUnique({ where: { id: reportId }, select: { classSectionId: true, status: true } })
  if (!r) return fail('NOT_FOUND', 'Report not found')
  if (!(await canEditGroupReports(user, r.classSectionId))) return fail('FORBIDDEN', 'Not your group')
  if (r.status !== 'DRAFT') return fail('ALREADY_SENT', 'This report was already sent')
  await deliver(reportId, user.id)
  return { ok: true }
}

let lastSweep = 0
/**
 * Every few minutes (from the notification-count poll and the daily job): make missing reports of the last 3 days
 * (e.g. QR attendance), then send the ones whose time has come.
 */
export async function sweepSessionReports(force = false) {
  if (!force && Date.now() - lastSweep < 2 * 60_000) return { made: 0, sent: 0 }
  lastSweep = Date.now()
  const s = await getSessionReportSettings()
  if (!s.enabled) return { made: 0, sent: 0 }
  let made = 0, sent = 0
  const since = dateOnly(ymd(new Date(Date.now() - 3 * DAY)))
  const held = await prisma.enrollmentAttendanceRecord.findMany({
    where: { attendanceDate: { gte: since } },
    select: { attendanceDate: true, studentEnrollment: { select: { classSectionId: true } } },
    distinct: ['attendanceDate', 'studentEnrollmentId'],
    take: 5000,
  })
  const pairs = new Map<string, { groupId: string; date: string }>()
  for (const h of held) pairs.set(`${h.studentEnrollment.classSectionId}|${ymd(h.attendanceDate)}`, { groupId: h.studentEnrollment.classSectionId, date: ymd(h.attendanceDate) })
  if (pairs.size) {
    const have = await prisma.sessionReport.findMany({ where: { sessionDate: { gte: since } }, select: { classSectionId: true, sessionDate: true } })
    const haveSet = new Set(have.map((h) => `${h.classSectionId}|${ymd(h.sessionDate)}`))
    for (const [k, p] of pairs) {
      if (haveSet.has(k)) continue
      if (await ensureSessionReport(p.groupId, p.date, s).catch(() => null)) made++
    }
  }
  const due = await prisma.sessionReport.findMany({ where: { status: 'DRAFT', sendAt: { lte: new Date() } }, select: { id: true }, take: 200 })
  for (const r of due) if (await deliver(r.id, null)) sent++
  return { made, sent }
}

// ───────────────────────── staff: one session (attendance screen panel) ─────────────────────────

export async function staffSession(user: User, groupId: string, date: string) {
  if (!(await canViewGroupReports(user, groupId))) return fail('FORBIDDEN', 'Not your group') as Outcome<never>
  const settings = await getSessionReportSettings()
  const report = await ensureSessionReport(groupId, date, settings)
  const att = await attendanceOf(groupId, date)
  const studentIds = att.map((a) => a.studentEnrollment.studentId)
  const [students, extras] = await Promise.all([
    prisma.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, firstName: true, lastName: true }, orderBy: { firstName: 'asc' } }),
    report ? prisma.sessionReportStudent.findMany({ where: { reportId: report.id } }) : Promise.resolve([]),
  ])
  const missing = report ? await reportMissing(report.classSectionId, report.sessionNumber) : []
  return {
    ok: true,
    value: {
      enabled: settings.enabled, mode: settings.mode, hours: settings.hours, phrases: settings.phrases,
      canEdit: !!report && report.status === 'DRAFT' && (await canEditGroupReports(user, groupId)),
      report: report && { id: report.id, status: report.status, sendAt: report.sendAt, sentAt: report.sentAt, sessionNumber: report.sessionNumber, groupNote: report.groupNote },
      missing,
      students: students.map((st) => {
        const e = extras.find((x) => x.studentId === st.id)
        return { id: st.id, name: name(st), attendance: att.find((a) => a.studentEnrollment.studentId === st.id)?.status ?? null, star: !!e?.star, phrases: (e?.phrases as string[] | null) ?? [], comment: e?.comment ?? '' }
      }),
    },
  }
}

/** What is still missing for a session's report: previous homework not graded, quiz answers waiting for review. */
async function reportMissing(groupId: string, sessionNumber: number | null) {
  if (!sessionNumber) return []
  const gl = await groupLessons(groupId).catch(() => null)
  const cur = gl?.sessions.find((x) => x.number === gl.range.from - 1 + sessionNumber)
  if (!gl || !cur) return []
  const prev = gl.sessions.find((x) => x.number === cur.number - 1)
  const blocks = await prisma.curriculumBlock.findMany({ where: { sessionId: { in: [cur.id, ...(prev ? [prev.id] : [])] }, type: { in: ['ASSIGNMENT', 'QUIZ'] } }, select: { id: true, type: true, sessionId: true } })
  const hwIds = blocks.filter((b) => b.type === 'ASSIGNMENT' && prev && b.sessionId === prev.id).map((b) => b.id)
  const quizIds = blocks.filter((b) => b.type === 'QUIZ' && b.sessionId === cur.id).map((b) => b.id)
  const [ungradedHomework, quizReview] = await Promise.all([
    hwIds.length ? prisma.assignmentSubmission.count({ where: { classSectionId: groupId, blockId: { in: hwIds }, status: 'SUBMITTED' } }) : 0,
    quizIds.length ? prisma.quizAttempt.count({ where: { classSectionId: groupId, blockId: { in: quizIds }, status: 'SUBMITTED' } }) : 0,
  ])
  return missingPieces({ ungradedHomework, quizReview }).map((k) => ({ key: k, count: k === 'HOMEWORK_UNGRADED' ? ungradedHomework : quizReview }))
}

export async function updateExtras(user: User, reportId: string, input: { groupNote?: string | null; students?: { studentId: string; star?: boolean; phrases?: string[]; comment?: string | null }[] }): Promise<Outcome> {
  const r = await prisma.sessionReport.findUnique({ where: { id: reportId } })
  if (!r) return fail('NOT_FOUND', 'Report not found')
  if (!(await canEditGroupReports(user, r.classSectionId))) return fail('FORBIDDEN', 'Not your group')
  if (r.status !== 'DRAFT') return fail('ALREADY_SENT', 'This report was already sent and cannot be changed')
  const settings = await getSessionReportSettings()
  const inSession = new Set((await attendanceOf(r.classSectionId, ymd(r.sessionDate))).map((a) => a.studentEnrollment.studentId))
  if (input.groupNote !== undefined) await prisma.sessionReport.update({ where: { id: r.id }, data: { groupNote: input.groupNote || null } })
  for (const st of input.students ?? []) {
    if (!inSession.has(st.studentId)) continue
    const data = {
      ...(st.star !== undefined && { star: st.star }),
      ...(st.phrases !== undefined && { phrases: cleanPhrases(st.phrases, settings.phrases) }),
      ...(st.comment !== undefined && { comment: st.comment || null }),
    }
    await prisma.sessionReportStudent.upsert({ where: { reportId_studentId: { reportId: r.id, studentId: st.studentId } }, create: { reportId: r.id, studentId: st.studentId, ...data }, update: data })
  }
  return { ok: true }
}

// ───────────────────────── one student's report ─────────────────────────

/** The report as the student / parent / staff sees it. Parents and students: SENT only. */
export async function studentReport(user: User, reportId: string, studentId: string) {
  const r = await prisma.sessionReport.findUnique({ where: { id: reportId }, include: { students: { where: { studentId } } } })
  if (!r) return null
  const viewer = await studentViewer(user, studentId)
  const staffOk = await canViewGroupReports(user, r.classSectionId)
  const family = viewer === 'PARENT' || viewer === 'STUDENT'
  if (!staffOk && !family) return null
  if (!staffOk && r.status !== 'SENT') return null
  const date = ymd(r.sessionDate)
  const rec = await prisma.enrollmentAttendanceRecord.findFirst({
    where: { attendanceDate: r.sessionDate, studentEnrollment: { classSectionId: r.classSectionId, studentId } },
    select: { status: true },
  })
  if (!rec) return null
  const [student, group, teacher, settings] = await Promise.all([
    prisma.student.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true, registrationNumber: true } }),
    prisma.classSection.findUnique({ where: { id: r.classSectionId }, select: { className: true, sectionName: true, level: { select: { name: true, subject: { select: { name: true } } } }, campus: { select: { name: true } } } }),
    r.teacherId ? prisma.teacher.findUnique({ where: { id: r.teacherId }, select: { firstName: true, lastName: true } }) : Promise.resolve(null),
    getSessionReportSettings(),
  ])
  const gl = r.sessionNumber ? await groupLessons(r.classSectionId).catch(() => null) : null
  const cur = gl && r.sessionNumber ? gl.sessions.find((x) => x.number === gl.range.from - 1 + r.sessionNumber!) : undefined
  const now = new Date()

  let previousHomework: { title: string; state: string; grade: string; score: number | null; maxScore: number | null; gradesAt: Date | null }[] = []
  let nextHomework: { title: string; dueAt: Date | null }[] = []
  let quizzes: { title: string; state: string; percent: number | null; passed: boolean | null }[] = []
  let activities: { title: string; percent: number | null; completed: boolean }[] = []
  if (gl && cur) {
    const [list, policy] = await Promise.all([groupAssignments(r.classSectionId, { lessons: gl }), policyForGroup(r.classSectionId)])
    const prevList = list.filter((a) => a.sessionNumber === cur.number - 1)
    const subs = await prisma.assignmentSubmission.findMany({ where: { classSectionId: r.classSectionId, studentId, blockId: { in: prevList.map((a) => a.blockId) } }, select: { blockId: true, status: true, late: true, score: true, maxScore: true } })
    previousHomework = prevList.map((a) => {
      const sub = subs.find((x) => x.blockId === a.blockId) ?? null
      const vis = visibility(policy, a, sub, now)
      return { title: a.titleEn || a.sessionTitleEn, ...homeworkLine({ sub, dueAt: a.dueAt, now, gradesVisible: vis.grades }), gradesAt: vis.gradesAt }
    })
    nextHomework = list.filter((a) => a.sessionNumber === cur.number).map((a) => ({ title: a.titleEn || a.sessionTitleEn, dueAt: a.dueAt }))
    const qBlocks = await prisma.curriculumBlock.findMany({ where: { sessionId: cur.id, type: 'QUIZ' }, select: { id: true, titleEn: true, data: true } })
    const atts = qBlocks.length ? await prisma.quizAttempt.findMany({ where: { classSectionId: r.classSectionId, studentId, blockId: { in: qBlocks.map((b) => b.id) } }, select: { blockId: true, status: true, score: true, maxScore: true, createdAt: true } }) : []
    const aBlocks = await prisma.curriculumBlock.findMany({ where: { sessionId: cur.id, type: 'H5P' }, select: { id: true, titleEn: true } })
    if (aBlocks.length) {
      const res = await prisma.h5PResult.findMany({ where: { classSectionId: r.classSectionId, studentId, blockId: { in: aBlocks.map((b) => b.id) } } })
      activities = aBlocks.map((b) => {
        const x = res.find((y) => y.blockId === b.id)
        return { title: b.titleEn || 'Activity', percent: x?.score != null && x.maxScore ? Math.round((x.score / x.maxScore) * 100) : null, completed: !!x?.completed }
      })
    }
    quizzes = qBlocks.flatMap((b) => {
      const d = parseQuiz(b.data)
      return d ? [{ title: b.titleEn || 'Quiz', ...quizLine(atts.filter((a) => a.blockId === b.id), d.scoring, d.passMark) }] : []
    })
  }
  const e = r.students[0]
  const phraseIds = (e?.phrases as string[] | null) ?? []
  return {
    id: r.id, status: r.status, sentAt: r.sentAt, date, sessionNumber: r.sessionNumber, perCycle: gl?.perCycle ?? null,
    student: { id: studentId, name: name(student), reg: student?.registrationNumber ?? '' },
    group: { id: r.classSectionId, label: `${group?.className ?? ''} ${group?.sectionName ?? ''}`.trim(), course: group?.level?.subject?.name ?? '', level: group?.level?.name ?? '', campus: group?.campus?.name ?? '' },
    teacher: name(teacher),
    lesson: cur ? { id: cur.id, titleEn: cur.titleEn, titleAr: cur.titleAr, objectivesEn: cur.objectivesEn, objectivesAr: cur.objectivesAr } : null,
    attendance: rec.status,
    missedLessonLink: cur && (rec.status === 'ABSENT' || rec.status === 'EXCUSED') ? `/dashboard/my-lessons/${cur.id}?g=${r.classSectionId}` : null,
    previousHomework, quizzes, activities, nextHomework,
    star: !!e?.star,
    phrases: settings.phrases.filter((p) => phraseIds.includes(p.id)).map((p) => ({ en: p.en, ar: p.ar || p.en })),
    comment: e?.comment ?? null,
    groupNote: r.groupNote,
  }
}

/** Session reports of a student, newest first (families: sent only). */
export async function studentReportEntries(studentId: string, includeDrafts: boolean) {
  const recs = await prisma.enrollmentAttendanceRecord.findMany({
    where: { studentEnrollment: { studentId } }, orderBy: { attendanceDate: 'desc' }, take: 120,
    select: { attendanceDate: true, studentEnrollment: { select: { classSectionId: true } } },
  })
  if (!recs.length) return []
  const reports = await prisma.sessionReport.findMany({
    where: { OR: recs.map((x) => ({ classSectionId: x.studentEnrollment.classSectionId, sessionDate: x.attendanceDate })), ...(includeDrafts ? {} : { status: 'SENT' }) },
    orderBy: { sessionDate: 'desc' }, take: 60,
    include: { students: { where: { studentId }, select: { star: true } } },
  })
  const groups = await prisma.classSection.findMany({ where: { id: { in: [...new Set(reports.map((r) => r.classSectionId))] } }, select: { id: true, className: true, sectionName: true, level: { select: { name: true, subject: { select: { name: true } } } } } })
  return reports.map((r) => {
    const g = groups.find((x) => x.id === r.classSectionId)
    return { id: r.id, groupId: r.classSectionId, date: ymd(r.sessionDate), status: r.status, sessionNumber: r.sessionNumber, star: !!r.students[0]?.star, group: `${g?.className ?? ''} ${g?.sectionName ?? ''}`.trim(), course: g?.level?.subject?.name ?? '', level: g?.level?.name ?? '' }
  })
}

// ───────────────────────── staff list + "not complete" ─────────────────────────

async function scopeGroupIds(user: User): Promise<string[] | null> {
  const role = user.role as Role
  if (role === 'TEACHER') {
    const t = await getTeacherByUserId(user.id)
    if (!t) return []
    const subs = (await prisma.substituteAssignment.findMany({ where: { substituteTeacherId: t.id, status: 'CONFIRMED' }, select: { classSectionId: true } })).map((s) => s.classSectionId)
    return [...new Set([...(await getTeacherClassSectionIds(t.id)), ...subs])]
  }
  const p = await requestPlaces(user)
  if (p.all) return null
  return (await prisma.classSection.findMany({ where: groupWhere(p), select: { id: true } })).map((g) => g.id)
}

export async function staffList(user: User, f: { from: string; to: string; status?: string | null; groupId?: string | null }) {
  const scope = await scopeGroupIds(user)
  const ids = f.groupId ? (scope && !scope.includes(f.groupId) ? [] : [f.groupId]) : scope
  const reports = await prisma.sessionReport.findMany({
    where: { sessionDate: { gte: dateOnly(f.from), lte: dateOnly(f.to) }, ...(ids ? { classSectionId: { in: ids } } : {}), ...(f.status ? { status: f.status } : {}) },
    orderBy: [{ sessionDate: 'desc' }], take: 300,
    include: { _count: { select: { students: true } } },
  })
  const gIds = [...new Set(reports.map((r) => r.classSectionId))]
  const [groups, teachers] = await Promise.all([
    prisma.classSection.findMany({ where: { id: { in: gIds } }, select: { id: true, className: true, sectionName: true, campus: { select: { name: true } }, level: { select: { name: true, subject: { select: { name: true } } } } } }),
    prisma.teacher.findMany({ where: { id: { in: reports.map((r) => r.teacherId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } }),
  ])
  const rows = []
  for (const r of reports) {
    const g = groups.find((x) => x.id === r.classSectionId)
    rows.push({
      id: r.id, groupId: r.classSectionId, date: ymd(r.sessionDate), sessionNumber: r.sessionNumber, status: r.status, sendAt: r.sendAt, sentAt: r.sentAt,
      group: `${g?.className ?? ''} ${g?.sectionName ?? ''}`.trim(), course: g?.level?.subject?.name ?? '', level: g?.level?.name ?? '', campus: g?.campus?.name ?? '',
      teacher: name(teachers.find((t) => t.id === r.teacherId)), extras: r._count.students,
      missing: r.status === 'DRAFT' || ymd(r.sessionDate) >= ymd(new Date(Date.now() - 14 * DAY)) ? await reportMissing(r.classSectionId, r.sessionNumber) : [],
    })
  }
  return rows
}

/** Sessions of the last 7 days whose attendance is missing (so no report can be made yet). */
export async function missingAttendance(user: User) {
  const scope = await scopeGroupIds(user)
  const today = cairoToday()
  const from = ymd(new Date(dateOnly(today).getTime() - 7 * DAY))
  const occ = await occurrencesFor(scope ? { groupIds: scope } : {}, from, today)
  return occ.flatMap((g) => g.occurrences.filter((o) => o.status === 'MISSING' && o.date < today).map((o) => ({ groupId: g.id, group: g.label, date: o.date, sessionNumber: o.sessionNumber })))
}
