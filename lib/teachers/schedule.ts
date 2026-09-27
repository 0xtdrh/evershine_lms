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
