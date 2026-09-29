import { prisma } from '@/lib/prisma'
import { sessionsPerCycle as cycleSessionCount } from '@/lib/groups/cycle-rules'
import { getActiveAcademicYear } from '@/lib/academic/engine'

export interface ScheduledSession {
  classSectionId: string
  className: string
  sectionName: string
  time: string // "HH:MM"
  courseName: string | null
  levelName: string | null
  hasNotStarted: boolean
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
          startDate: true, currentCycleStartDate: true,
          level: { select: { name: true, subject: { select: { name: true } } } },
        },
      },
    },
  })

  const sessions: ScheduledSession[] = []
  for (const o of offerings) {
    const cs = o.classSection
    if (!cs.isActive || cs.status === 'COMPLETED') continue
    // A group with no start date yet hasn't actually begun — still shown
    // (so it's not a dead end for marking that first session), but flagged
    // so the UI can make clear it hasn't started and hide "Excuse" for it.
    const hasNotStarted = !cs.startDate && !cs.currentCycleStartDate
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
          hasNotStarted,
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
export async function getRemainingCycleSessions(
  classSectionId: string,
  opts: { allowNotStarted?: boolean } = {}
): Promise<RemainingSession[]> {
  const group = await prisma.classSection.findUnique({
    where: { id: classSectionId },
    select: {
      currentCycleStartDate: true, startDate: true, scheduleSlots: true,
      level: { select: { numberOfSessions: true, numberOfMonths: true } },
    },
  })
  if (!group || !group.level) return []

  // Brand-new groups (from /advance-cycle) have no startDate yet — it
  // hasn't actually begun, so there's nothing to excuse until it does.
  // (Only session *labelling* passes allowNotStarted, to number the first
  // upcoming session as 1.)
  let cycleStart: Date | null = group.currentCycleStartDate ?? group.startDate
  if (!cycleStart && opts.allowNotStarted) {
    cycleStart = new Date()
    cycleStart.setHours(0, 0, 0, 0)
  }
  if (!cycleStart) return []

  const sessionsPerCycle = cycleSessionCount(group.level)

  const attended = await prisma.enrollmentAttendanceRecord.findMany({
    where: { studentEnrollment: { classSectionId }, attendanceDate: { gte: cycleStart } },
    select: { attendanceDate: true },
    distinct: ['attendanceDate'],
  })
  const sessionsSoFar = attended.length
  // A day whose session is already recorded must not be projected again as
  // an upcoming one (otherwise today's finished session gets counted twice).
  const attendedDates = new Set(attended.map((a) => a.attendanceDate.toISOString().slice(0, 10)))
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
    const cursorDateStr = cursor.toISOString().slice(0, 10)
    const matchingSlots = attendedDates.has(cursorDateStr)
      ? []
      : slots.filter((s) => s.dayOfWeek === dow).sort((a, b) => a.time.localeCompare(b.time))
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

/**
 * "Session N of M" for one specific date of a group's current cycle — shown
 * to a substitute so they know exactly which lesson they're covering.
 * Looks at the projected upcoming sessions first; for a date that already
 * happened it counts the attendance sessions recorded up to that day.
 * Null when it can't be worked out (e.g. the group hasn't started yet).
 */
export async function getSessionNumberForDate(
  classSectionId: string,
  dateStr: string
): Promise<{ sessionNumber: number; totalSessions: number } | null> {
  const upcoming = await getRemainingCycleSessions(classSectionId, { allowNotStarted: true })
  const match = upcoming.find((s) => s.date === dateStr)
  if (match) return { sessionNumber: match.sessionNumber, totalSessions: match.totalSessions }

  const group = await prisma.classSection.findUnique({
    where: { id: classSectionId },
    select: {
      currentCycleStartDate: true, startDate: true,
      level: { select: { numberOfSessions: true, numberOfMonths: true } },
    },
  })
  const cycleStart = group?.currentCycleStartDate ?? group?.startDate
  if (!group?.level || !cycleStart) return null

  const target = new Date(`${dateStr}T00:00:00.000Z`)
  const attended = await prisma.enrollmentAttendanceRecord.findMany({
    where: { studentEnrollment: { classSectionId }, attendanceDate: { gte: cycleStart, lte: target } },
    select: { attendanceDate: true },
    distinct: ['attendanceDate'],
  })
  if (!attended.some((a) => a.attendanceDate.toISOString().slice(0, 10) === dateStr)) return null

  const totalSessions = cycleSessionCount(group.level)
  return { sessionNumber: attended.length, totalSessions }
}
