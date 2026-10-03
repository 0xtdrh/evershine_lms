/**
 * Phase C: student and parent feedback (docs/design-phase-c.md).
 *  - after each session the student rates it with one tap (1..4: 🙁 😐 🙂 😀);
 *    for children under the age set here (default 8) the parent answers instead
 *  - at the end of each month (group) the parent answers 3 questions (1..5):
 *    the sessions, the instructor, TechNova; at the end of the level the same
 *    survey is marked LEVEL
 *  - a low rating (session 🙁, or any survey answer ≤ 2) alerts the managers and
 *    adds a follow-up in the contact log
 *  - instructors only ever see their own averages, never names
 * Server-only.
 */

import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { cairoYmd, ageOn } from '@/lib/dates/cairo'
import { sessionsPerCycle, cyclesInLevel } from '@/lib/groups/cycle-rules'
import { pickGroupInstructorOffering } from '@/lib/groups/instructor'
import { notifyUsers, managerUserIds } from '@/lib/notifications/events'
import { logSystemContact } from '@/lib/contacts/contact-log'

export interface FeedbackSettings { parentAnswersUnderAge: number; sessionDays: number; surveyDays: number }
export const FEEDBACK_DEFAULTS: FeedbackSettings = { parentAnswersUnderAge: 8, sessionDays: 2, surveyDays: 21 }
export const getFeedbackSettings = async () => ({ ...FEEDBACK_DEFAULTS, ...(await getSetting<Partial<FeedbackSettings>>('ratings.settings', {})) })
export const saveFeedbackSettings = (v: FeedbackSettings, userId: string) => setSetting('ratings.settings', v, userId)

export const SESSION_FACES = ['', '🙁', '😐', '🙂', '😀'] as const
const day = (d: Date) => d.toISOString().slice(0, 10)

export async function isYoungChild(studentId: string): Promise<boolean> {
  const s = await prisma.student.findUnique({ where: { id: studentId }, select: { dateOfBirth: true } })
  const { parentAnswersUnderAge } = await getFeedbackSettings()
  return !!s?.dateOfBirth && ageOn(s.dateOfBirth, cairoYmd()) < parentAnswersUnderAge
}

/** Sessions of the last few days the student attended and has not rated yet. */
export async function pendingSessionRatings(studentId: string) {
  const { sessionDays } = await getFeedbackSettings()
  const since = new Date(Date.now() - (sessionDays + 1) * 86_400_000)
  const records = await prisma.enrollmentAttendanceRecord.findMany({
    where: { attendanceDate: { gte: since }, status: { in: ['PRESENT', 'LATE'] }, studentEnrollment: { studentId } },
    select: { attendanceDate: true, studentEnrollment: { select: { classSectionId: true, classSection: { select: { className: true, sectionName: true } } } } },
    orderBy: { attendanceDate: 'desc' },
  })
  if (!records.length) return []
  const done = await prisma.sessionFeedback.findMany({ where: { studentId, sessionDate: { gte: since } }, select: { classSectionId: true, sessionDate: true } })
  const doneKeys = new Set(done.map((d) => `${d.classSectionId}|${day(d.sessionDate)}`))
  return records
    .filter((r) => !doneKeys.has(`${r.studentEnrollment.classSectionId}|${day(r.attendanceDate)}`))
    .map((r) => ({ classSectionId: r.studentEnrollment.classSectionId, group: `${r.studentEnrollment.classSection.className} ${r.studentEnrollment.classSection.sectionName}`.trim(), date: day(r.attendanceDate) }))
}

async function lowRatingAlert(studentId: string, text: string) {
  const s = await prisma.student.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true, campusId: true, guardians: { select: { id: true } } } })
  if (!s) return
  await notifyUsers(await managerUserIds(s.campusId), 'LOW_RATING', { title: 'Low rating', message: `${s.firstName} ${s.lastName}: ${text}. A follow-up was added.`, relatedId: studentId })
  await logSystemContact({ studentId, guardianId: s.guardians[0]?.id ?? null, channel: 'SYSTEM', direction: 'IN', reason: 'COMPLAINT', summary: `Low rating: ${text}. Please call the parent.`, followUpAt: new Date() })
}

export interface FeedbackOutcome { ok: boolean; code?: number; message?: string }

export async function rateSession(input: { studentId: string; classSectionId: string; sessionDate: string; rating: number; comment?: string | null; userId: string; byRole: 'STUDENT' | 'PARENT' }): Promise<FeedbackOutcome> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 4) return { ok: false, code: 400, message: 'Choose a face' }
  const pending = await pendingSessionRatings(input.studentId)
  const g = pending.find((p) => p.classSectionId === input.classSectionId && p.date === input.sessionDate)
  if (!g) return { ok: false, code: 409, message: 'This session cannot be rated (already rated, too old, or the student was absent)' }
  await prisma.sessionFeedback.create({
    data: { studentId: input.studentId, classSectionId: input.classSectionId, sessionDate: new Date(`${input.sessionDate}T00:00:00.000Z`), rating: input.rating, comment: input.comment?.slice(0, 500) || null, byUserId: input.userId, byRole: input.byRole },
  })
  if (input.rating <= 1) await lowRatingAlert(input.studentId, `session ${input.sessionDate} in ${g.group} rated ${SESSION_FACES[input.rating]}${input.comment ? ` — "${input.comment.slice(0, 200)}"` : ''}`)
  return { ok: true }
}

/** Surveys the parent can answer now: groups at (or just after) the end of their month. */
export async function pendingSurveys(studentId: string) {
  const { surveyDays } = await getFeedbackSettings()
  const since = new Date(Date.now() - surveyDays * 86_400_000)
  const enrollments = await prisma.studentEnrollment.findMany({
    where: {
      studentId,
      classSection: { levelId: { not: null }, OR: [{ status: 'ACTIVE' }, { status: 'COMPLETED', completedAt: { gte: since } }] },
    },
    select: {
      classSectionId: true,
      classSection: { select: { className: true, sectionName: true, status: true, currentCycleNumber: true, currentCycleStartDate: true, startDate: true, level: { select: { name: true, numberOfSessions: true, numberOfMonths: true, pricingType: true, subject: { select: { name: true } } } } } },
    },
  })
  if (!enrollments.length) return []
  const done = await prisma.parentSurvey.findMany({ where: { studentId, classSectionId: { in: enrollments.map((e) => e.classSectionId) } }, select: { classSectionId: true } })
  const doneIds = new Set(done.map((d) => d.classSectionId))
  const out: { classSectionId: string; group: string; course: string | null; level: string | null; kind: 'MONTHLY' | 'LEVEL' }[] = []
  for (const e of enrollments) {
    if (doneIds.has(e.classSectionId)) continue
    const cs = e.classSection
    if (!cs.level) continue
    const per = sessionsPerCycle(cs.level)
    let ready = cs.status === 'COMPLETED'
    if (!ready) {
      const start = cs.currentCycleStartDate ?? cs.startDate
      const held = start ? (await prisma.enrollmentAttendanceRecord.findMany({ where: { studentEnrollment: { classSectionId: e.classSectionId }, attendanceDate: { gte: start } }, select: { attendanceDate: true }, distinct: ['attendanceDate'] })).length : 0
      ready = held >= Math.max(1, per - 1)
    }
    if (!ready) continue
    out.push({
      classSectionId: e.classSectionId,
      group: `${cs.className} ${cs.sectionName}`.trim(),
      course: cs.level.subject?.name ?? null,
      level: cs.level.name,
      kind: cs.currentCycleNumber >= cyclesInLevel(cs.level) ? 'LEVEL' : 'MONTHLY',
    })
  }
  return out
}

export async function submitSurvey(input: { studentId: string; classSectionId: string; sessionsRating: number; teacherRating: number; companyRating: number; comment?: string | null; userId: string }): Promise<FeedbackOutcome> {
  const ratings = [input.sessionsRating, input.teacherRating, input.companyRating]
  if (ratings.some((r) => !Number.isInteger(r) || r < 1 || r > 5)) return { ok: false, code: 400, message: 'Answer the three questions (1 to 5)' }
  const pending = (await pendingSurveys(input.studentId)).find((p) => p.classSectionId === input.classSectionId)
  if (!pending) return { ok: false, code: 409, message: 'This survey is not open (already answered, or the month has not ended yet)' }
  const g = await prisma.classSection.findUnique({
    where: { id: input.classSectionId },
    select: { level: { select: { subject: { select: { id: true } } } }, subjectOfferings: { select: { subjectId: true, academicYearId: true, teacherId: true, createdAt: true } } },
  })
  const teacherId = g ? pickGroupInstructorOffering(g.subjectOfferings, g.level?.subject?.id, null)?.teacherId ?? null : null
  await prisma.parentSurvey.create({
    data: {
      studentId: input.studentId, classSectionId: input.classSectionId, kind: pending.kind, teacherId,
      sessionsRating: input.sessionsRating, teacherRating: input.teacherRating, companyRating: input.companyRating,
      comment: input.comment?.slice(0, 1000) || null, byUserId: input.userId,
    },
  })
  if (ratings.some((r) => r <= 2)) {
    await lowRatingAlert(input.studentId, `parent rated ${pending.group}: sessions ${input.sessionsRating}/5, instructor ${input.teacherRating}/5, TechNova ${input.companyRating}/5${input.comment ? ` — "${input.comment.slice(0, 200)}"` : ''}`)
  }
  return { ok: true }
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)

/** Averages for one instructor (anonymous: no names, no comments with names). */
export async function teacherAverages(teacherId: string, sinceDays = 180) {
  const since = new Date(Date.now() - sinceDays * 86_400_000)
  const groups = (await prisma.subjectOffering.findMany({ where: { teacherId }, select: { classSectionId: true } })).map((o) => o.classSectionId)
  const [sessions, surveys] = await Promise.all([
    prisma.sessionFeedback.findMany({ where: { classSectionId: { in: groups }, createdAt: { gte: since } }, select: { rating: true } }),
    prisma.parentSurvey.findMany({ where: { teacherId, createdAt: { gte: since } }, select: { sessionsRating: true, teacherRating: true } }),
  ])
  return {
    sessionFaces: { average: avg(sessions.map((s) => s.rating)), count: sessions.length, outOf: 4 },
    parentsOnInstructor: { average: avg(surveys.map((s) => s.teacherRating)), count: surveys.length, outOf: 5 },
    parentsOnSessions: { average: avg(surveys.map((s) => s.sessionsRating)), count: surveys.length, outOf: 5 },
  }
}

/** Managers: averages per instructor and per group + the latest answers with names. */
export async function feedbackOverview(opts: { campusId?: string | null; sinceDays?: number }) {
  const since = new Date(Date.now() - (opts.sinceDays ?? 90) * 86_400_000)
  const groupWhere = opts.campusId ? { campusId: opts.campusId } : {}
  const groupRows = await prisma.classSection.findMany({ where: { ...groupWhere, levelId: { not: null } }, select: { id: true, className: true, sectionName: true } })
  const gIds = groupRows.map((g) => g.id)
  const gLabel = new Map(groupRows.map((g) => [g.id, `${g.className} ${g.sectionName}`.trim()]))
  const [sessions, surveys] = await Promise.all([
    prisma.sessionFeedback.findMany({ where: { classSectionId: { in: gIds }, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' } }),
    prisma.parentSurvey.findMany({ where: { classSectionId: { in: gIds }, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' } }),
  ])
  const teacherIds = [...new Set(surveys.map((s) => s.teacherId).filter((x): x is string => !!x))]
  const offerings = await prisma.subjectOffering.findMany({ where: { classSectionId: { in: [...new Set(sessions.map((s) => s.classSectionId))] }, teacherId: { not: null } }, select: { classSectionId: true, teacherId: true, createdAt: true }, orderBy: { createdAt: 'desc' } })
  const teacherOfGroup = new Map<string, string>()
  for (const o of offerings) if (o.teacherId && !teacherOfGroup.has(o.classSectionId)) teacherOfGroup.set(o.classSectionId, o.teacherId)
  const allTeacherIds = [...new Set([...teacherIds, ...teacherOfGroup.values()])]
  const [teachers, students] = await Promise.all([
    prisma.teacher.findMany({ where: { id: { in: allTeacherIds } }, select: { id: true, firstName: true, lastName: true } }),
    prisma.student.findMany({ where: { id: { in: [...new Set([...sessions, ...surveys].map((x) => x.studentId))] } }, select: { id: true, firstName: true, lastName: true } }),
  ])
  const tName = new Map(teachers.map((t) => [t.id, `${t.firstName} ${t.lastName}`]))
  const sName = new Map(students.map((s) => [s.id, `${s.firstName} ${s.lastName}`]))

  const byTeacher = allTeacherIds.map((id) => {
    const ss = sessions.filter((s) => teacherOfGroup.get(s.classSectionId) === id)
    const sv = surveys.filter((s) => s.teacherId === id)
    return { teacherId: id, name: tName.get(id) ?? '—', sessionFaces: avg(ss.map((s) => s.rating)), sessionCount: ss.length, instructor: avg(sv.map((s) => s.teacherRating)), sessionsQ: avg(sv.map((s) => s.sessionsRating)), company: avg(sv.map((s) => s.companyRating)), surveyCount: sv.length }
  }).sort((a, b) => (a.instructor ?? 9) - (b.instructor ?? 9))

  return {
    since: day(since),
    totals: {
      sessionFaces: avg(sessions.map((s) => s.rating)), sessionCount: sessions.length,
      instructor: avg(surveys.map((s) => s.teacherRating)), sessionsQ: avg(surveys.map((s) => s.sessionsRating)), company: avg(surveys.map((s) => s.companyRating)), surveyCount: surveys.length,
    },
    byTeacher,
    latestSurveys: surveys.slice(0, 50).map((s) => ({ id: s.id, student: sName.get(s.studentId) ?? '—', studentId: s.studentId, group: gLabel.get(s.classSectionId) ?? '—', kind: s.kind, instructor: s.teacherId ? tName.get(s.teacherId) ?? '—' : '—', sessionsRating: s.sessionsRating, teacherRating: s.teacherRating, companyRating: s.companyRating, comment: s.comment, createdAt: s.createdAt })),
    lowSessions: sessions.filter((s) => s.rating <= 1).slice(0, 30).map((s) => ({ id: s.id, student: sName.get(s.studentId) ?? '—', studentId: s.studentId, group: gLabel.get(s.classSectionId) ?? '—', date: day(s.sessionDate), rating: s.rating, comment: s.comment, byRole: s.byRole })),
  }
}
