/**
 * Phase C: sessions of some groups between two dates, for server features
 * that need "which sessions are there" without the calendar page — the
 * parent's excuse form, the morning summary, dashboard numbers.
 * Same maths as GET /api/groups/schedule (buildOccurrences + holidays/extras).
 * Server-only.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sessionsPerCycle } from './cycle-rules'
import { buildOccurrences, cleanSlots, toDay, type Occurrence } from './schedule-calendar'
import { groupExceptions } from './calendar-exceptions'
import { pickGroupInstructorOffering } from './instructor'
import { cairoToday } from '@/lib/dates/cairo'

export interface GroupOccurrences {
  id: string
  label: string
  campusId: string
  teacherId: string | null
  teacherUserId: string | null
  occurrences: Occurrence[]
}

export async function occurrencesFor(
  where: { groupIds?: string[]; campusId?: string | null },
  from: string,
  to: string,
  opts: { activeYearId?: string | null } = {}
): Promise<GroupOccurrences[]> {
  const fromD = new Date(`${from}T00:00:00.000Z`)
  const groups = await prisma.classSection.findMany({
    where: {
      isActive: true,
      levelId: { not: null },
      ...(where.groupIds ? { id: { in: where.groupIds } } : { OR: [{ status: 'ACTIVE' }, { status: 'COMPLETED', completedAt: { gte: fromD } }] }),
      ...(where.campusId && { campusId: where.campusId }),
    },
    select: {
      id: true, className: true, sectionName: true, status: true, startDate: true, currentCycleStartDate: true, scheduleSlots: true, campusId: true,
      level: { select: { numberOfSessions: true, numberOfMonths: true, pricingType: true, subject: { select: { id: true } } } },
      subjectOfferings: { select: { subjectId: true, academicYearId: true, teacherId: true, createdAt: true, teacher: { select: { id: true, userId: true } } } },
    },
  })
  if (!groups.length) return []
  const ids = groups.map((g) => g.id)
  const heldRows = await prisma.$queryRaw<{ g: string; d: string }[]>`
    SELECT e.classSectionId AS g, DATE_FORMAT(r.attendanceDate, '%Y-%m-%d') AS d
      FROM EnrollmentAttendanceRecord r
      JOIN StudentEnrollment e ON e.id = r.studentEnrollmentId
     WHERE e.classSectionId IN (${Prisma.join(ids)})
     GROUP BY e.classSectionId, d`
  const heldBy = new Map<string, string[]>()
  for (const r of heldRows) heldBy.set(r.g, [...(heldBy.get(r.g) ?? []), r.d])
  const cancelledRows = await prisma.cancelledSession.findMany({ where: { classSectionId: { in: ids } }, select: { classSectionId: true, date: true } })
  const cancelledBy = new Map<string, string[]>()
  for (const c of cancelledRows) cancelledBy.set(c.classSectionId, [...(cancelledBy.get(c.classSectionId) ?? []), toDay(c.date)])
  const exceptions = await groupExceptions(groups.map((g) => ({ id: g.id, campusId: g.campusId })))
  const today = cairoToday()

  return groups.map((g) => {
    const held = heldBy.get(g.id) ?? []
    const cycleStartDate = g.currentCycleStartDate ?? g.startDate
    const cycleStart = cycleStartDate ? toDay(cycleStartDate) : held.length ? [...held].sort()[0] : null
    const offering = pickGroupInstructorOffering(g.subjectOfferings, g.level?.subject?.id, opts.activeYearId ?? undefined)
    return {
      id: g.id,
      label: `${g.className} ${g.sectionName}`.trim(),
      campusId: g.campusId,
      teacherId: offering?.teacher?.id ?? null,
      teacherUserId: offering?.teacher?.userId ?? null,
      occurrences: buildOccurrences(
        {
          id: g.id,
          slots: cleanSlots(g.scheduleSlots),
          completed: g.status === 'COMPLETED',
          cycleStart,
          sessionsPerCycle: g.level ? sessionsPerCycle(g.level) : 1,
          heldDates: cycleStart ? held.filter((d) => d >= cycleStart) : [],
          cancelledDates: cancelledBy.get(g.id) ?? [],
          holidayDates: exceptions.get(g.id)?.holidays ?? [],
          extras: exceptions.get(g.id)?.extras ?? [],
        },
        from, to, today
      ),
    }
  })
}
