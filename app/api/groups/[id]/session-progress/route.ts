/**
 * GET /api/groups/[id]/session-progress
 * Read-only. Tells the attendance-marking screen where this group is in its
 * current cycle: "Session X of N", and whether this would be the last
 * session (so the teacher knows the level is about to close). Never writes
 * anything — purely informational, computed the same way the automatic
 * cycle-closing logic (lib/groups/sync-progress.ts) counts sessions.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import type { Role } from '@prisma/client'

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
      currentCycleNumber: true,
      currentCycleStartDate: true,
      startDate: true,
      level: {
        select: {
          name: true,
          numberOfMonths: true,
          numberOfSessions: true,
          subject: { select: { name: true } },
        },
      },
    },
  })
  if (!group) return errors.notFound('Group')

  if (!group.level) {
    return successResponse({ hasLevel: false })
  }

  const cycleStart = group.currentCycleStartDate ?? group.startDate
  const sessionsPerCycle = Math.max(1, Math.round(group.level.numberOfSessions / group.level.numberOfMonths))

  let sessionsSoFar = 0
  if (cycleStart) {
    const records = await prisma.enrollmentAttendanceRecord.findMany({
      where: { studentEnrollment: { classSectionId: id }, attendanceDate: { gte: cycleStart } },
      select: { attendanceDate: true },
      distinct: ['attendanceDate'],
    })
    sessionsSoFar = records.length
  }

  return successResponse({
    hasLevel: true,
    courseName: group.level.subject.name,
    levelName: group.level.name,
    cycleNumber: group.currentCycleNumber,
    sessionsSoFar,
    sessionsPerCycle,
    // The NEXT session marked would be number (sessionsSoFar + 1); this is
    // the last one for the cycle if that equals the total.
    nextSessionNumber: Math.min(sessionsSoFar + 1, sessionsPerCycle),
    isLastSessionOfCycle: sessionsSoFar + 1 >= sessionsPerCycle,
  })
}
