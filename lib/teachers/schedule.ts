import { prisma } from '@/lib/prisma'
import { getActiveAcademicYear } from '@/lib/academic/engine'

export interface ScheduledSession {
  classSectionId: string
  className: string
  sectionName: string
  time: string // "HH:MM"
  courseName: string | null
  levelName: string | null
}

/**
 * Every session this teacher is assigned to teach on the given date's day
 * of week (from each active group's scheduleSlots), ordered earliest first.
 */
export async function getTeacherSessionsOnDate(teacherId: string, date: Date): Promise<ScheduledSession[]> {
  const activeYear = await getActiveAcademicYear()
  if (!activeYear) return []

  const dayOfWeek = date.getDay() // 0=Sunday..6=Saturday, matches how scheduleSlots was written elsewhere

  const offerings = await prisma.subjectOffering.findMany({
    where: { teacherId, academicYearId: activeYear.id },
    select: {
      classSection: {
        select: {
          id: true, className: true, sectionName: true, scheduleSlots: true, isActive: true, status: true,
          level: { select: { name: true, subject: { select: { name: true } } } },
        },
      },
    },
  })

  const sessions: ScheduledSession[] = []
  for (const o of offerings) {
    const cs = o.classSection
    if (!cs.isActive || cs.status === 'COMPLETED') continue
    const slots = Array.isArray(cs.scheduleSlots) ? (cs.scheduleSlots as { dayOfWeek: number; time: string }[]) : []
    for (const slot of slots) {
      if (slot.dayOfWeek === dayOfWeek) {
        sessions.push({
          classSectionId: cs.id,
          className: cs.className,
          sectionName: cs.sectionName,
          time: slot.time,
          courseName: cs.level?.subject.name ?? null,
          levelName: cs.level?.name ?? null,
        })
      }
    }
  }

  return sessions.sort((a, b) => a.time.localeCompare(b.time))
}

/** Combines a date with an "HH:MM" time string into a single Date. */
export function combineDateAndTime(date: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number)
  const combined = new Date(date)
  combined.setHours(h || 0, m || 0, 0, 0)
  return combined
}

export interface RemainingSession {
  date: string // YYYY-MM-DD
  time: string
  sessionNumber: number
  totalSessions: number
}

/**
 * The sessions still left in a group's CURRENT cycle, projected forward
 * from today using its scheduleSlots recurrence, each tagged with its
 * session number (e.g. "Session 3 of 4"). Used to let a teacher pick
 * exactly one upcoming session to excuse (instead of only "today"), and to
 * show a substitute which session number they're covering.
 */
export async function getRemainingCycleSessions(classSectionId: string): Promise<RemainingSession[]> {
  const group = await prisma.classSection.findUnique({
    where: { id: classSectionId },
    select: {
      currentCycleStartDate: true, startDate: true, scheduleSlots: true,
      level: { select: { numberOfSessions: true, numberOfMonths: true } },
    },
  })
  if (!group || !group.level) return []

  const cycleStart = group.currentCycleStartDate ?? group.startDate
  if (!cycleStart) return []

  const sessionsPerCycle = Math.max(1, Math.round(group.level.numberOfSessions / group.level.numberOfMonths))

  const attended = await prisma.enrollmentAttendanceRecord.findMany({
    where: { studentEnrollment: { classSectionId }, attendanceDate: { gte: cycleStart } },
    select: { attendanceDate: true },
    distinct: ['attendanceDate'],
  })
  const sessionsSoFar = attended.length
  const remaining = Math.max(0, sessionsPerCycle - sessionsSoFar)
  if (remaining === 0) return []

  const slots = Array.isArray(group.scheduleSlots) ? (group.scheduleSlots as { dayOfWeek: number; time: string }[]) : []
  if (slots.length === 0) return []

  const results: RemainingSession[] = []
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  let sessionNum = sessionsSoFar + 1
  let daysChecked = 0
  while (results.length < remaining && daysChecked < 120) {
    const dow = cursor.getDay()
    const matchingSlots = slots.filter((s) => s.dayOfWeek === dow).sort((a, b) => a.time.localeCompare(b.time))
    for (const slot of matchingSlots) {
      if (results.length >= remaining) break
      results.push({ date: cursor.toISOString().slice(0, 10), time: slot.time, sessionNumber: sessionNum, totalSessions: sessionsPerCycle })
      sessionNum++
    }
    cursor.setDate(cursor.getDate() + 1)
    daysChecked++
  }
  return results
}
