/**
 * R2 instructor performance (owner 2026-10-11). For one instructor over a period: attendance of their groups, parent
 * ratings, renewal rate, complaints / praise, work waiting to be graded + grading time, session reports and sessions
 * without attendance. Managers see every instructor of their scope; an instructor sees only their own page and only
 * when the setting allows it (`teacherPerformance.settings.teacherCanSee`, off by default). Read-only. Server-only.
 */

import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { campusScope } from '@/lib/academic/api-helpers'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { getTeacherByUserId, getTeacherClassSectionIds } from '@/lib/academic/teacher-scope'
import { attendanceStats } from '@/lib/attendance/timeline-calc'
import { occurrencesFor } from '@/lib/groups/occurrences'
import { gradingHours, pct } from '@/lib/lms/analytics-calc'

type User = { id: string; role: string; campusId?: string | null }
export interface PerformanceSettings { teacherCanSee: boolean }
const KEY = 'teacherPerformance.settings'
export const getPerformanceSettings = async (): Promise<PerformanceSettings> => ({ teacherCanSee: false, ...(await getSetting<Partial<PerformanceSettings>>(KEY, {})) })
export const savePerformanceSettings = (v: PerformanceSettings, userId: string) => setSetting(KEY, v, userId)

const MANAGERS: Role[] = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER']
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)
const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** Which instructors this person may look at (null = not allowed at all). */
export async function performanceScope(user: User): Promise<{ teacherIds: string[] | 'ALL_IN_SCOPE'; campusId: string | null; own: boolean } | null> {
  const role = user.role as Role
  if (MANAGERS.includes(role)) return { teacherIds: 'ALL_IN_SCOPE', campusId: campusScope(role, user.campusId, null) ?? null, own: false }
  if (role === 'TEACHER') {
    if (!(await getPerformanceSettings()).teacherCanSee) return null
    const t = await getTeacherByUserId(user.id)
    return t ? { teacherIds: [t.id], campusId: null, own: true } : null
  }
  return null
}

export async function teacherList(campusId: string | null) {
  const rows = await prisma.teacher.findMany({ where: { isActive: true, ...(campusId ? { campusId } : {}) }, select: { id: true, firstName: true, lastName: true, campus: { select: { name: true } } }, orderBy: { firstName: 'asc' } })
  return rows.map((t) => ({ id: t.id, name: `${t.firstName} ${t.lastName}`.trim(), campus: t.campus?.name ?? '' }))
}

/** All numbers for one instructor in [from, to]. */
export async function teacherPerformance(teacherId: string, from: Date, to: Date) {
  const teacher = await prisma.teacher.findUnique({ where: { id: teacherId }, select: { id: true, firstName: true, lastName: true, userId: true, campus: { select: { name: true } } } })
  if (!teacher) return null
  const subs = (await prisma.substituteAssignment.findMany({ where: { substituteTeacherId: teacherId, status: 'CONFIRMED' }, select: { classSectionId: true } })).map((s) => s.classSectionId)
  const own = await getTeacherClassSectionIds(teacherId)
  const groupIds = [...new Set(own)]
  const range = { gte: from, lte: to }

  const [att, faces, surveys, renewals, complaints, ungradedHw, ungradedQuiz, gradedHw, gradedQuiz, reports, groups] = await Promise.all([
    prisma.enrollmentAttendanceRecord.findMany({ where: { attendanceDate: range, studentEnrollment: { classSectionId: { in: groupIds } } }, select: { status: true, studentEnrollment: { select: { classSectionId: true } } } }),
    prisma.sessionFeedback.findMany({ where: { classSectionId: { in: groupIds }, sessionDate: range }, select: { rating: true } }),
    prisma.parentSurvey.findMany({ where: { teacherId, createdAt: range }, select: { teacherRating: true, sessionsRating: true } }),
    prisma.renewalRequest.findMany({ where: { classSectionId: { in: groupIds }, respondedAt: range, status: { in: ['YES', 'NO'] } }, select: { status: true } }),
    prisma.complaint.findMany({ where: { classSectionId: { in: groupIds }, createdAt: range }, select: { kind: true } }),
    prisma.assignmentSubmission.count({ where: { classSectionId: { in: [...groupIds, ...subs] }, status: 'SUBMITTED' } }),
    prisma.quizAttempt.count({ where: { classSectionId: { in: [...groupIds, ...subs] }, status: 'SUBMITTED' } }),
    prisma.assignmentSubmission.findMany({ where: { gradedById: teacher.userId, gradedAt: range }, select: { submittedAt: true, gradedAt: true, gradedById: true } }),
    prisma.quizAttempt.findMany({ where: { gradedById: teacher.userId, gradedAt: range }, select: { submittedAt: true, gradedAt: true, gradedById: true } }),
    prisma.sessionReport.findMany({ where: { classSectionId: { in: groupIds }, sessionDate: range }, select: { status: true, groupNote: true, _count: { select: { students: true } } } }),
    prisma.classSection.findMany({ where: { id: { in: groupIds } }, select: { id: true, className: true, sectionName: true, status: true } }),
  ])
  const occ: Awaited<ReturnType<typeof occurrencesFor>> = await occurrencesFor({ groupIds }, ymd(from), ymd(to < new Date() ? to : new Date())).catch(() => [])
  const missingAttendance = occ.flatMap((g) => g.occurrences).filter((o) => o.status === 'MISSING').length
  const held = occ.flatMap((g) => g.occurrences).filter((o) => o.status === 'HELD').length
  const attendance = attendanceStats(att.map((a) => a.status))
  const yes = renewals.filter((r) => r.status === 'YES').length
  const activeGroups = groups.filter((g) => g.status === 'ACTIVE').length
  return {
    teacher: { id: teacher.id, name: `${teacher.firstName} ${teacher.lastName}`.trim(), campus: teacher.campus?.name ?? '' },
    period: { from: ymd(from), to: ymd(to) },
    groups: { active: activeGroups, total: groupIds.length, sessionsHeld: held, coveredAsSubstitute: subs.length },
    attendance: { pct: attendance.pct, records: attendance.sessions, absent: attendance.absent },
    ratings: {
      sessionFaces: { average: avg(faces.map((f) => f.rating)), count: faces.length, outOf: 4 },
      parentsOnInstructor: { average: avg(surveys.map((s) => s.teacherRating)), count: surveys.length, outOf: 5 },
    },
    renewal: { pct: pct(yes, renewals.length), yes, answered: renewals.length },
    complaints: { complaints: complaints.filter((c) => c.kind === 'COMPLAINT').length, praise: complaints.filter((c) => c.kind === 'PRAISE').length, suggestions: complaints.filter((c) => c.kind === 'SUGGESTION').length },
    grading: { waiting: ungradedHw + ungradedQuiz, gradedInPeriod: gradedHw.length + gradedQuiz.length, averageHours: gradingHours([...gradedHw, ...gradedQuiz]) },
    reports: { total: reports.length, sent: reports.filter((r) => r.status === 'SENT').length, withPersonalNote: pct(reports.filter((r) => r._count.students > 0 || r.groupNote).length, reports.length) },
    missingAttendance,
  }
}

/** One short line per instructor for the managers' table. */
export async function performanceTable(campusId: string | null, from: Date, to: Date) {
  const list = await teacherList(campusId)
  const out = []
  for (const t of list.slice(0, 150)) {
    const p = await teacherPerformance(t.id, from, to)
    if (p) out.push(p)
  }
  return out
}
