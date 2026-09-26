/**
 * GET /api/groups/[id]/session-history
 * Read-only, additive to the attendance-marking screen. Returns:
 * - current: the active cycle's sessions (from currentCycleStartDate/
 *   startDate to now), labelled with the course/level.
 * - pastCycles: every closed cycle (from GroupCycleLog), each with its own
 *   reconstructed date window and session list — a past cycle's window runs
 *   from the previous log's completedAt (or the group's original
 *   startDate, for the very first cycle) to this log's completedAt.
 * Never writes anything.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import type { Role } from '@prisma/client'

async function sessionsBetween(classSectionId: string, from: Date, to: Date | null) {
  const records = await prisma.enrollmentAttendanceRecord.findMany({
    where: {
      studentEnrollment: { classSectionId },
      attendanceDate: { gte: from, ...(to && { lt: to }) },
    },
    select: { attendanceDate: true },
    distinct: ['attendanceDate'],
    orderBy: { attendanceDate: 'asc' },
  })
  return records.map((r, i) => ({ sessionNumber: i + 1, date: r.attendanceDate.toISOString().slice(0, 10) }))
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'attendance', 'read')
  if (denied) return denied

  const { id } = await params
  const group = await prisma.classSection.findUnique({
    where: { id },
    select: {
      startDate: true,
      currentCycleStartDate: true,
      currentCycleNumber: true,
      level: { select: { name: true, subject: { select: { name: true } } } },
    },
  })
  if (!group) return errors.notFound('Group')

  const logs = await prisma.groupCycleLog.findMany({
    where: { classSectionId: id },
    orderBy: { completedAt: 'asc' },
    select: { id: true, type: true, cycleNumber: true, completedAt: true, levelId: true },
  })

  const levelIds = [...new Set(logs.map((l) => l.levelId).filter((v): v is string => !!v))]
  const levels = levelIds.length > 0
    ? await prisma.level.findMany({ where: { id: { in: levelIds } }, select: { id: true, name: true, subject: { select: { name: true } } } })
    : []
  const levelById = new Map(levels.map((l) => [l.id, l]))

  const pastCycles = []
  let windowStart = group.startDate
  for (const log of logs) {
    if (windowStart) {
      const sessions = await sessionsBetween(id, windowStart, log.completedAt)
      const logLevel = log.levelId ? levelById.get(log.levelId) : null
      pastCycles.push({
        id: log.id,
        label: log.type === 'MONTH_COMPLETED'
          ? `${logLevel?.subject.name ?? ''} ${logLevel?.name ?? ''} — Month ${log.cycleNumber}`.trim()
          : `${logLevel?.subject.name ?? ''} ${logLevel?.name ?? ''} — completed`.trim(),
        completedAt: log.completedAt.toISOString(),
        sessions,
      })
    }
    windowStart = log.completedAt
  }

  const currentStart = group.currentCycleStartDate ?? group.startDate
  const currentSessions = currentStart ? await sessionsBetween(id, currentStart, null) : []

  return successResponse({
    current: {
      courseName: group.level?.subject.name ?? null,
      levelName: group.level?.name ?? null,
      cycleNumber: group.currentCycleNumber,
      sessions: currentSessions,
    },
    pastCycles: pastCycles.reverse(), // most recent first
  })
}
