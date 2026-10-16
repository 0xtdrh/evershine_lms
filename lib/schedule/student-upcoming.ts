/**
 * "My next sessions" for the student / parent portal (2026-10-17): the coming sessions of the student's active groups
 * on their real dates, with holidays ("postponed"), cancellations and makeup sessions — the same maths as the groups
 * calendar (buildOccurrences + holidays + extra sessions). No instructor names (portal rule). Server-only.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { cairoToday } from '@/lib/dates/cairo'
import { sessionsPerCycle } from '@/lib/groups/cycle-rules'
import { buildOccurrences, cleanSlots, toDay, type OccurrenceStatus } from '@/lib/groups/schedule-calendar'
import { groupExceptions } from '@/lib/groups/calendar-exceptions'

export interface UpcomingSession {
  groupId: string
  group: string
  course: string | null
  date: string
  time: string
  status: OccurrenceStatus
  sessionNumber: number | null
  totalSessions: number
  isExtra: boolean
  cancelReason: string | null
}

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

export async function studentUpcomingSessions(studentId: string, opts: { days?: number; limit?: number } = {}): Promise<{ today: string; sessions: UpcomingSession[] }> {
  const today = cairoToday()
  const to = addDays(today, opts.days ?? 28)
  const enrollments = await prisma.studentEnrollment.findMany({
    where: { studentId, status: 'ACTIVE', classSection: { isActive: true, status: 'ACTIVE', levelId: { not: null } } },
    select: {
      classSection: {
        select: {
          id: true, className: true, sectionName: true, campusId: true, scheduleSlots: true, startDate: true, currentCycleStartDate: true,
          level: { select: { name: true, numberOfSessions: true, numberOfMonths: true, pricingType: true, subject: { select: { name: true } } } },
        },
      },
    },
  })
  const groups = [...new Map(enrollments.map((e) => [e.classSection.id, e.classSection])).values()]
  if (!groups.length) return { today, sessions: [] }
  const ids = groups.map((g) => g.id)

  const heldRows = await prisma.$queryRaw<{ g: string; d: string }[]>`
    SELECT e.classSectionId AS g, DATE_FORMAT(r.attendanceDate, '%Y-%m-%d') AS d
      FROM EnrollmentAttendanceRecord r
      JOIN StudentEnrollment e ON e.id = r.studentEnrollmentId
     WHERE e.classSectionId IN (${Prisma.join(ids)})
     GROUP BY e.classSectionId, d`
  const heldBy = new Map<string, string[]>()
  for (const r of heldRows) heldBy.set(r.g, [...(heldBy.get(r.g) ?? []), r.d])
  const [logs, cancelledRows, exceptions] = await Promise.all([
    prisma.groupSessionLog.findMany({ where: { classSectionId: { in: ids } }, select: { classSectionId: true, sessionDate: true, status: true } }),
    prisma.cancelledSession.findMany({ where: { classSectionId: { in: ids } }, select: { classSectionId: true, date: true, reason: true } }),
    groupExceptions(groups.map((g) => ({ id: g.id, campusId: g.campusId }))),
  ])
  for (const l of logs.filter((x) => x.status === 'HELD')) heldBy.set(l.classSectionId, [...new Set([...(heldBy.get(l.classSectionId) ?? []), toDay(l.sessionDate)])])
  const cancelledBy = new Map<string, { date: string; reason: string | null }[]>()
  for (const c of cancelledRows) cancelledBy.set(c.classSectionId, [...(cancelledBy.get(c.classSectionId) ?? []), { date: toDay(c.date), reason: c.reason }])
  for (const l of logs.filter((x) => x.status !== 'HELD')) cancelledBy.set(l.classSectionId, [...(cancelledBy.get(l.classSectionId) ?? []), { date: toDay(l.sessionDate), reason: null }])

  const out: UpcomingSession[] = []
  for (const g of groups) {
    const held = heldBy.get(g.id) ?? []
    const startD = g.currentCycleStartDate ?? g.startDate
    const cycleStart = startD ? toDay(startD) : held.length ? [...held].sort()[0] : null
    const cancelled = cancelledBy.get(g.id) ?? []
    const occ = buildOccurrences({
      id: g.id,
      slots: cleanSlots(g.scheduleSlots),
      completed: false,
      cycleStart,
      sessionsPerCycle: g.level ? sessionsPerCycle(g.level) : 1,
      heldDates: cycleStart ? held.filter((d) => d >= cycleStart) : [],
      cancelledDates: cancelled.map((c) => c.date),
      holidayDates: exceptions.get(g.id)?.holidays ?? [],
      extras: exceptions.get(g.id)?.extras ?? [],
    }, today, to, today)
    for (const o of occ) {
      if (o.date < today || o.status === 'HELD' || o.status === 'MISSING') continue
      out.push({
        groupId: g.id, group: `${g.className} ${g.sectionName}`.trim(), course: g.level?.subject?.name ?? null,
        date: o.date, time: o.time, status: o.status, sessionNumber: o.sessionNumber, totalSessions: o.totalSessions,
        isExtra: !!o.isExtra, cancelReason: o.status === 'CANCELLED' ? cancelled.find((c) => c.date === o.date)?.reason ?? null : null,
      })
    }
  }
  out.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)))
  return { today, sessions: out.slice(0, opts.limit ?? 8) }
}
