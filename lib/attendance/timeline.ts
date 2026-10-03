/**
 * Phase C: a student's attendance, session by session, per group (= per month),
 * for the parent and student portals and the reports. No instructor name
 * (owner, 2026-10-03). Server-only.
 */

import { prisma } from '@/lib/prisma'
import { sessionsPerCycle, cyclesInLevel } from '@/lib/groups/cycle-rules'
import { attendanceStats, numberSessions, isPerfectAttendance, type SessionRow, type AttendanceStats } from './timeline-calc'

const day = (d: Date) => d.toISOString().slice(0, 10)

export interface GroupAttendance {
  classSectionId: string
  group: string
  course: string | null
  level: string | null
  levelId: string | null
  cycleNumber: number
  cyclesInLevel: number
  status: string
  finished: boolean
  sessions: SessionRow[]
  stats: AttendanceStats
  perfect: boolean
}

export async function studentAttendanceTimeline(studentId: string, opts: { groupIds?: string[]; limit?: number } = {}): Promise<{ groups: GroupAttendance[]; overall: AttendanceStats }> {
  const enrollments = await prisma.studentEnrollment.findMany({
    where: { studentId, ...(opts.groupIds && { classSectionId: { in: opts.groupIds } }), classSection: { levelId: { not: null } } },
    select: {
      id: true,
      classSectionId: true,
      createdAt: true,
      classSection: {
        select: {
          className: true, sectionName: true, status: true, currentCycleNumber: true, currentCycleStartDate: true, startDate: true, createdAt: true,
          level: { select: { id: true, name: true, numberOfSessions: true, numberOfMonths: true, pricingType: true, subject: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 24,
  })
  if (!enrollments.length) return { groups: [], overall: attendanceStats([]) }
  const groupIds = enrollments.map((e) => e.classSectionId)
  const [groupDates, own, excuses] = await Promise.all([
    prisma.enrollmentAttendanceRecord.findMany({
      where: { studentEnrollment: { classSectionId: { in: groupIds } } },
      select: { attendanceDate: true, studentEnrollment: { select: { classSectionId: true } } },
      distinct: ['attendanceDate', 'studentEnrollmentId'],
    }),
    prisma.enrollmentAttendanceRecord.findMany({
      where: { studentEnrollmentId: { in: enrollments.map((e) => e.id) } },
      select: { studentEnrollmentId: true, attendanceDate: true, status: true },
    }),
    prisma.absenceExcuse.findMany({ where: { studentId, classSectionId: { in: groupIds }, status: 'APPROVED' }, select: { classSectionId: true, sessionDate: true, reason: true } }),
  ])
  const heldBy = new Map<string, Set<string>>()
  for (const r of groupDates) {
    const g = r.studentEnrollment.classSectionId
    if (!heldBy.has(g)) heldBy.set(g, new Set())
    heldBy.get(g)!.add(day(r.attendanceDate))
  }
  const allStatuses: string[] = []
  const groups = enrollments.map((e) => {
    const cs = e.classSection
    const per = cs.level ? sessionsPerCycle(cs.level) : 1
    // Each month is its own group, so every session of the group belongs to this month.
    const held = [...(heldBy.get(e.classSectionId) ?? [])]
    const recs = own.filter((r) => r.studentEnrollmentId === e.id).map((r) => ({ date: day(r.attendanceDate), status: r.status }))
    const ex = new Map(excuses.filter((x) => x.classSectionId === e.classSectionId).map((x) => [day(x.sessionDate), x.reason]))
    const sessions = numberSessions(held, recs, per, ex)
    const stats = attendanceStats(sessions.map((s) => s.status))
    allStatuses.push(...sessions.map((s) => s.status))
    const finished = cs.status === 'COMPLETED' || held.length >= per
    return {
      classSectionId: e.classSectionId,
      group: `${cs.className} ${cs.sectionName}`.trim(),
      course: cs.level?.subject?.name ?? null,
      level: cs.level?.name ?? null,
      levelId: cs.level?.id ?? null,
      cycleNumber: cs.currentCycleNumber,
      cyclesInLevel: cs.level ? cyclesInLevel(cs.level) : 1,
      status: cs.status,
      finished,
      sessions,
      stats,
      perfect: isPerfectAttendance(sessions, finished),
    }
  })
  return { groups, overall: attendanceStats(allStatuses) }
}
