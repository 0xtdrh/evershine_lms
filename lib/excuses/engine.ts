/**
 * Phase C: absence excuses (docs/design-phase-c.md).
 *  - a parent sends an excuse for one session (before it, or up to N days after)
 *  - accepted automatically or waits for staff approval (ExcuseRule per scope)
 *  - approved → that session's attendance is EXCUSED (now if already recorded,
 *    or when it is recorded: see approvedExcusesFor / the attendance route)
 *  - an excused absence still counts as a used session for refunds (owner: the seat was reserved)
 * Server-only.
 */

import { prisma } from '@/lib/prisma'
import { cairoToday } from '@/lib/dates/cairo'
import { occurrencesFor } from '@/lib/groups/occurrences'
import { notifyFamilies, notifyUsers, branchStaffUserIds } from '@/lib/notifications/events'
import { checkPermission } from '@/lib/rbac'
import { resolveExcuseRule, excuseWindow, type ExcuseSettings } from './rules'

export async function excuseSettingsFor(classSectionId: string): Promise<ExcuseSettings> {
  const g = await prisma.classSection.findUnique({
    where: { id: classSectionId },
    select: { level: { select: { subjectId: true, subject: { select: { trackId: true } } } } },
  })
  const rules = await prisma.excuseRule.findMany()
  return resolveExcuseRule(rules, { groupId: classSectionId, courseId: g?.level?.subjectId, trackId: g?.level?.subject?.trackId })
}

const day = (d: Date) => d.toISOString().slice(0, 10)

/** Marks a recorded ABSENT as EXCUSED once the excuse is approved. */
async function applyToAttendance(excuse: { studentId: string; classSectionId: string; sessionDate: Date; reason: string }) {
  await prisma.enrollmentAttendanceRecord.updateMany({
    where: {
      attendanceDate: excuse.sessionDate,
      status: 'ABSENT',
      studentEnrollment: { studentId: excuse.studentId, classSectionId: excuse.classSectionId },
    },
    data: { status: 'EXCUSED', remarks: `Excuse: ${excuse.reason}`.slice(0, 190) },
  })
}

/** ok=false → code (HTTP-like) + message. */
export interface ExcuseOutcome { ok: boolean; id?: string; status?: string; code?: number; message?: string }

export async function submitExcuse(input: { studentId: string; classSectionId: string; sessionDate: string; reason: string; userId: string }): Promise<ExcuseOutcome> {
  const reason = input.reason.trim()
  if (reason.length < 2) return { ok: false, code: 400, message: 'Write the reason' }
  const enrollment = await prisma.studentEnrollment.findFirst({
    where: { studentId: input.studentId, classSectionId: input.classSectionId },
    select: { status: true },
  })
  if (!enrollment) return { ok: false, code: 404, message: 'The student is not in this group' }
  const settings = await excuseSettingsFor(input.classSectionId)
  const w = excuseWindow(input.sessionDate, cairoToday(), settings.daysAfter)
  if (!w.ok) return { ok: false, code: 409, message: w.reason }
  // It must be a real session of the group on that day.
  const [g] = await occurrencesFor({ groupIds: [input.classSectionId] }, input.sessionDate, input.sessionDate)
  const occ = g?.occurrences.find((o) => o.date === input.sessionDate && ['HELD', 'MISSING', 'SCHEDULED', 'NOT_STARTED'].includes(o.status))
  if (!occ) return { ok: false, code: 409, message: 'There is no session of this group on that day' }
  if (occ.status === 'HELD') {
    const rec = await prisma.enrollmentAttendanceRecord.findFirst({
      where: { attendanceDate: new Date(`${input.sessionDate}T00:00:00.000Z`), studentEnrollment: { studentId: input.studentId, classSectionId: input.classSectionId } },
      select: { status: true },
    })
    if (rec && rec.status !== 'ABSENT' && rec.status !== 'EXCUSED') return { ok: false, code: 409, message: 'The student attended this session' }
  }

  const sessionDate = new Date(`${input.sessionDate}T00:00:00.000Z`)
  const existing = await prisma.absenceExcuse.findUnique({
    where: { studentId_classSectionId_sessionDate: { studentId: input.studentId, classSectionId: input.classSectionId, sessionDate } },
  })
  if (existing && (existing.status === 'PENDING' || existing.status === 'APPROVED')) return { ok: false, code: 409, message: 'An excuse for this session was already sent' }
  const status = settings.autoApprove ? 'APPROVED' : 'PENDING'
  const data = {
    reason: reason.slice(0, 500),
    status,
    autoApproved: settings.autoApprove,
    submittedById: input.userId,
    decidedById: null,
    decidedAt: settings.autoApprove ? new Date() : null,
    decisionNote: null,
  }
  const excuse = existing
    ? await prisma.absenceExcuse.update({ where: { id: existing.id }, data })
    : await prisma.absenceExcuse.create({ data: { ...data, studentId: input.studentId, classSectionId: input.classSectionId, sessionDate } })

  const info = await prisma.classSection.findUnique({ where: { id: input.classSectionId }, select: { className: true, sectionName: true, campusId: true } })
  const student = await prisma.student.findUnique({ where: { id: input.studentId }, select: { firstName: true, lastName: true } })
  const label = `${info?.className ?? ''} ${info?.sectionName ?? ''}`.trim()
  if (status === 'APPROVED') {
    await applyToAttendance(excuse)
  } else {
    const staff = (await branchStaffUserIds(info?.campusId)).filter(Boolean)
    const [teacherGroup] = g ? [g] : []
    await notifyUsers([...staff, teacherGroup?.teacherUserId], 'EXCUSE_PENDING', {
      title: 'Absence excuse to review',
      message: `${student?.firstName ?? ''} ${student?.lastName ?? ''} — ${label}, session ${input.sessionDate}: ${reason.slice(0, 200)}`,
      relatedId: excuse.id,
    })
  }
  return { ok: true, id: excuse.id, status }
}

export async function decideExcuse(input: { id: string; action: 'approve' | 'reject'; note?: string | null; userId: string }): Promise<ExcuseOutcome> {
  const e = await prisma.absenceExcuse.findUnique({ where: { id: input.id } })
  if (!e) return { ok: false, code: 404, message: 'Excuse not found' }
  if (e.status !== 'PENDING') return { ok: false, code: 409, message: 'This excuse was already decided' }
  const status = input.action === 'approve' ? 'APPROVED' : 'REJECTED'
  await prisma.absenceExcuse.update({
    where: { id: e.id },
    data: { status, decidedById: input.userId, decidedAt: new Date(), decisionNote: input.note?.slice(0, 500) ?? null },
  })
  if (status === 'APPROVED') await applyToAttendance(e)
  const d = day(e.sessionDate)
  await notifyFamilies([e.studentId], 'EXCUSE_DECIDED', (s) => ({
    title: status === 'APPROVED' ? 'Excuse accepted' : 'Excuse not accepted',
    message: status === 'APPROVED'
      ? `${s.firstName}'s excuse for the session on ${d} was accepted.`
      : `${s.firstName}'s excuse for the session on ${d} was not accepted${input.note ? `: ${input.note}` : '.'}`,
    relatedId: e.id,
  }))
  return { ok: true, id: e.id, status }
}

/** The parent withdraws an excuse that is still waiting, or one for a session that has not happened yet. */
export async function cancelExcuse(id: string, userId: string): Promise<ExcuseOutcome> {
  const e = await prisma.absenceExcuse.findUnique({ where: { id } })
  if (!e) return { ok: false, code: 404, message: 'Excuse not found' }
  const future = day(e.sessionDate) > cairoToday()
  if (!(e.status === 'PENDING' || (e.status === 'APPROVED' && future))) return { ok: false, code: 409, message: 'This excuse can no longer be withdrawn' }
  await prisma.absenceExcuse.update({ where: { id }, data: { status: 'CANCELLED', decidedById: userId, decidedAt: new Date() } })
  return { ok: true, id, status: 'CANCELLED' }
}

/** Approved / pending excuses of a group on one date, by student id (attendance screen + save). */
export async function excusesOn(classSectionId: string, date: Date) {
  const rows = await prisma.absenceExcuse.findMany({
    where: { classSectionId, sessionDate: date, status: { in: ['PENDING', 'APPROVED'] } },
    select: { id: true, studentId: true, reason: true, status: true },
  })
  return new Map(rows.map((r) => [r.studentId, r]))
}

/** Who may decide excuses: staff with absence_excuses:approve. */
export const canDecideExcuses = (role: string) => checkPermission(role, 'absence_excuses', 'approve')

const addDaysStr = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10)

/**
 * Sessions a parent can send an excuse for: the student's active groups,
 * from N days back (the group's setting) to 30 days ahead, skipping sessions
 * the student attended and ones that already have an excuse.
 */
export async function excusableSessions(studentId: string) {
  const enrollments = await prisma.studentEnrollment.findMany({
    where: { studentId, status: 'ACTIVE', classSection: { status: 'ACTIVE', levelId: { not: null } } },
    select: { id: true, classSectionId: true },
  })
  if (!enrollments.length) return []
  const today = cairoToday()
  const settings = new Map<string, ExcuseSettings>()
  for (const e of enrollments) settings.set(e.classSectionId, await excuseSettingsFor(e.classSectionId))
  const maxBack = Math.max(0, ...[...settings.values()].map((s) => s.daysAfter))
  const from = addDaysStr(today, -maxBack)
  const to = addDaysStr(today, 30)
  const groups = await occurrencesFor({ groupIds: enrollments.map((e) => e.classSectionId) }, from, to)
  const [records, excuses] = await Promise.all([
    prisma.enrollmentAttendanceRecord.findMany({
      where: { studentEnrollmentId: { in: enrollments.map((e) => e.id) }, attendanceDate: { gte: new Date(`${from}T00:00:00.000Z`) } },
      select: { studentEnrollmentId: true, attendanceDate: true, status: true },
    }),
    prisma.absenceExcuse.findMany({ where: { studentId, sessionDate: { gte: new Date(`${from}T00:00:00.000Z`) }, status: { in: ['PENDING', 'APPROVED'] } }, select: { classSectionId: true, sessionDate: true } }),
  ])
  const enrOf = new Map(enrollments.map((e) => [e.classSectionId, e.id]))
  const statusOf = new Map(records.map((r) => [`${r.studentEnrollmentId}|${day(r.attendanceDate)}`, r.status]))
  const excused = new Set(excuses.map((x) => `${x.classSectionId}|${day(x.sessionDate)}`))
  const out: { classSectionId: string; group: string; date: string; time: string; sessionNumber: number | null; totalSessions: number; past: boolean }[] = []
  for (const g of groups) {
    const s = settings.get(g.id) ?? { daysAfter: 2 }
    for (const o of g.occurrences) {
      if (!['HELD', 'MISSING', 'SCHEDULED', 'NOT_STARTED'].includes(o.status)) continue
      if (!excuseWindow(o.date, today, s.daysAfter).ok) continue
      if (excused.has(`${g.id}|${o.date}`)) continue
      const st = statusOf.get(`${enrOf.get(g.id)}|${o.date}`)
      if (st && st !== 'ABSENT') continue
      out.push({ classSectionId: g.id, group: g.label, date: o.date, time: o.time, sessionNumber: o.sessionNumber, totalSessions: o.totalSessions, past: o.date < today })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
}
