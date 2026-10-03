/**
 * GET /api/groups/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Every session of every group between two dates (max 62 days), for the
 * weekly / monthly Groups calendar. Maths: lib/groups/schedule-calendar.ts.
 * Each session carries its number ("3 of 8"), status (held / attendance
 * missing / upcoming / not started / cancelled), the teacher who teaches it
 * (substitute when one is assigned), an approved teacher absence, and a
 * conflict flag (same teacher, same date and time).
 *
 * Staff: groups of their branch (Super Admin: all). Teachers: only their own
 * groups and the sessions they cover as a substitute.
 * Filtering by branch / track / course / teacher happens in the page.
 */

import { NextRequest } from 'next/server'
import { Prisma, type Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { getTeacherByUserId } from '@/lib/academic/teacher-scope'
import { pickGroupInstructorOffering } from '@/lib/groups/instructor'
import { sessionsPerCycle } from '@/lib/groups/cycle-rules'
import { buildOccurrences, cleanSlots, findConflicts, toDay, type OccurrenceStatus } from '@/lib/groups/schedule-calendar'
import { groupExceptions } from '@/lib/groups/calendar-exceptions'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role

  const sp = new URL(request.url).searchParams
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  if (!DATE.test(from) || !DATE.test(to) || from > to) return errors.badRequest('from and to must be dates (YYYY-MM-DD), from before to')
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 62) return errors.badRequest('At most 62 days at a time')

  let ownTeacherId: string | null = null
  if (role === 'TEACHER') {
    const t = await getTeacherByUserId(session.user.id)
    if (!t) return errors.forbidden('No teacher profile for this account')
    ownTeacherId = t.id
  } else {
    const denied = requirePermission(role, 'class_sections', 'read')
    if (denied) return denied
  }
  const campusId = ownTeacherId ? undefined : campusScope(role, session.user.campusId, null)
  const fromD = new Date(`${from}T00:00:00.000Z`)
  const toD = new Date(`${to}T00:00:00.000Z`)
  const activeYearId = (await getActiveAcademicYear())?.id

  // Substitutes in the range (also brings a teacher's covered groups in).
  const subs = await prisma.substituteAssignment.findMany({
    where: { date: { gte: fromD, lte: toD }, status: { not: 'DECLINED' }, ...(ownTeacherId && { substituteTeacherId: ownTeacherId }) },
    select: { classSectionId: true, date: true, status: true, substituteTeacher: { select: { id: true, firstName: true, lastName: true } } },
  })

  const groupsRaw = await prisma.classSection.findMany({
    where: {
      isActive: true,
      levelId: { not: null },
      OR: [{ status: 'ACTIVE' }, { status: 'COMPLETED', completedAt: { gte: fromD } }],
      ...(campusId && { campusId }),
    },
    select: {
      id: true, className: true, sectionName: true, status: true, startDate: true, currentCycleStartDate: true,
      currentCycleNumber: true, scheduleSlots: true, campusId: true,
      campus: { select: { id: true, name: true } },
      level: {
        select: {
          id: true, name: true, numberOfSessions: true, numberOfMonths: true, pricingType: true,
          subject: { select: { id: true, name: true, track: { select: { id: true, name: true } } } },
        },
      },
      subjectOfferings: {
        select: { subjectId: true, academicYearId: true, teacherId: true, createdAt: true, teacher: { select: { id: true, firstName: true, lastName: true } } },
      },
      _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
    },
  })
  const coveredIds = new Set(subs.map((s) => s.classSectionId))
  const groups = groupsRaw
    .map((g) => {
      const t = pickGroupInstructorOffering(g.subjectOfferings, g.level?.subject?.id, activeYearId)?.teacher ?? null
      return { g, teacher: t ? { id: t.id, name: `${t.firstName} ${t.lastName}` } : null }
    })
    .filter(({ g, teacher }) => !ownTeacherId || teacher?.id === ownTeacherId || coveredIds.has(g.id))
  const ids = groups.map(({ g }) => g.id)
  if (!ids.length) return successResponse({ from, to, today: toDay(new Date()), groups: [], sessions: [] })

  // Distinct attendance dates per group (= sessions held).
  const heldRows = await prisma.$queryRaw<{ g: string; d: string }[]>`
    SELECT e.classSectionId AS g, DATE_FORMAT(r.attendanceDate, '%Y-%m-%d') AS d
      FROM EnrollmentAttendanceRecord r
      JOIN StudentEnrollment e ON e.id = r.studentEnrollmentId
     WHERE e.classSectionId IN (${Prisma.join(ids)})
     GROUP BY e.classSectionId, d`
  const heldBy = new Map<string, string[]>()
  for (const r of heldRows) heldBy.set(r.g, [...(heldBy.get(r.g) ?? []), r.d])

  const [cancelledRows, absences] = await Promise.all([
    prisma.cancelledSession.findMany({ where: { classSectionId: { in: ids } }, select: { classSectionId: true, date: true, reason: true } }),
    prisma.teacherAbsence.findMany({
      where: { status: 'APPROVED', date: { gte: fromD, lte: toD } },
      select: { teacherId: true, date: true, scope: true, classSectionId: true },
    }),
  ])
  const exceptions = await groupExceptions(groups.map(({ g }) => ({ id: g.id, campusId: g.campusId })))
  const cancelledBy = new Map<string, { date: string; reason: string | null }[]>()
  for (const c of cancelledRows) cancelledBy.set(c.classSectionId, [...(cancelledBy.get(c.classSectionId) ?? []), { date: toDay(c.date), reason: c.reason }])
  const subOf = new Map(subs.map((s) => [`${s.classSectionId}|${toDay(s.date)}`, s]))

  const today = toDay(new Date())
  const sessions: {
    groupId: string; date: string; time: string; status: OccurrenceStatus; sessionNumber: number | null; totalSessions: number
    isLastOfCycle: boolean; isExtra?: boolean; teacherId: string | null; teacherName: string | null
    substitute: { name: string; confirmed: boolean } | null; teacherAbsent: boolean; cancelReason: string | null; conflict: boolean
  }[] = []

  for (const { g, teacher } of groups) {
    const held = heldBy.get(g.id) ?? []
    const cycleStartDate = g.currentCycleStartDate ?? g.startDate
    const cycleStart = cycleStartDate ? toDay(cycleStartDate) : held.length ? [...held].sort()[0] : null
    const cancelled = cancelledBy.get(g.id) ?? []
    const occ = buildOccurrences(
      {
        id: g.id,
        slots: cleanSlots(g.scheduleSlots),
        completed: g.status === 'COMPLETED',
        cycleStart,
        sessionsPerCycle: g.level ? sessionsPerCycle(g.level) : 1,
        heldDates: cycleStart ? held.filter((d) => d >= cycleStart) : [],
        cancelledDates: cancelled.map((c) => c.date),
        holidayDates: exceptions.get(g.id)?.holidays ?? [],
        extras: exceptions.get(g.id)?.extras ?? [],
      },
      from, to, today
    )
    for (const o of occ) {
      const sub = subOf.get(`${g.id}|${o.date}`)
      // A teacher sees only the sessions they teach (their groups, or the ones they cover).
      if (ownTeacherId && teacher?.id !== ownTeacherId && !sub) continue
      const absent = !!teacher && absences.some((a) => a.teacherId === teacher.id && toDay(a.date) === o.date && (a.scope === 'FULL_DAY' || a.classSectionId === g.id))
      const effective = sub?.status === 'CONFIRMED' ? { id: sub.substituteTeacher.id, name: `${sub.substituteTeacher.firstName} ${sub.substituteTeacher.lastName}` } : teacher
      sessions.push({
        ...o,
        teacherId: effective?.id ?? null,
        teacherName: effective?.name ?? null,
        substitute: sub ? { name: `${sub.substituteTeacher.firstName} ${sub.substituteTeacher.lastName}`, confirmed: sub.status === 'CONFIRMED' } : null,
        teacherAbsent: absent,
        cancelReason: o.status === 'CANCELLED' ? cancelled.find((c) => c.date === o.date)?.reason ?? null : null,
        conflict: false,
      })
    }
  }
  for (const i of findConflicts(sessions)) sessions[i].conflict = true
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))

  return successResponse({
    from,
    to,
    today,
    groups: groups.map(({ g, teacher }) => ({
      id: g.id,
      label: `${g.className} ${g.sectionName}`.trim(),
      campus: g.campus,
      course: g.level?.subject ? { id: g.level.subject.id, name: g.level.subject.name } : null,
      track: g.level?.subject?.track ?? null,
      level: g.level ? { id: g.level.id, name: g.level.name } : null,
      teacher,
      studentCount: g._count.enrollments,
      status: g.status,
      notStarted: !(g.currentCycleStartDate ?? g.startDate) && !(heldBy.get(g.id)?.length),
    })),
    sessions,
  })
}
