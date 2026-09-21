/**
 * POST /api/groups/[id]/advance-cycle
 * Body: { continuingStudentIds?: string[] }  — student IDs (not enrollment
 *   IDs) who continue into the new cycle. Any currently-active student not
 *   in this list is withdrawn from the group. Omit the field to keep
 *   everyone (backward-compatible default).
 *
 * - MONTHLY level    → logs the completed month, bumps currentCycleNumber,
 *                       resets currentCycleStartDate to today. Same level.
 * - FULL_LEVEL level → logs the completed level, moves to the next level of
 *                       the same course (by order). If there is no next
 *                       level, looks for the next course in the same Track
 *                       (by trackOrder) and moves to ITS first level
 *                       instead. Only if neither exists is the group marked
 *                       COMPLETED.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import type { Role } from '@prisma/client'

const bodySchema = z.object({
  continuingStudentIds: z.array(z.string()).optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'update')
  if (denied) return denied

  const { id } = await params
  const group = await prisma.classSection.findUnique({
    where: { id },
    include: {
      level: { include: { subject: true } },
      enrollments: { where: { status: 'ACTIVE' }, select: { id: true, studentId: true } },
    },
  })
  if (!group) return errors.notFound('Group')

  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && group.campusId !== campusId) return errors.forbidden()

  if (!group.level) {
    return errors.conflict('This group has no level assigned yet — set one before closing a cycle')
  }
  if (group.status === 'COMPLETED') {
    return errors.conflict('This group is already marked completed')
  }

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    // no body sent — fine, defaults to "everyone continues"
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const continuingIds = parsed.data.continuingStudentIds
  const enrollmentsToWithdraw = continuingIds
    ? group.enrollments.filter((e) => !continuingIds.includes(e.studentId)).map((e) => e.id)
    : []

  if (group.level.pricingType === 'MONTHLY') {
    const updated = await prisma.$transaction(async (tx) => {
      if (enrollmentsToWithdraw.length > 0) {
        await tx.studentEnrollment.updateMany({
          where: { id: { in: enrollmentsToWithdraw } },
          data: { status: 'WITHDRAWN' },
        })
      }
      await tx.groupCycleLog.create({
        data: {
          classSectionId: id,
          type: 'MONTH_COMPLETED',
          levelId: group.levelId,
          cycleNumber: group.currentCycleNumber,
          completedBy: session.user.id,
        },
      })
      return tx.classSection.update({
        where: { id },
        data: { currentCycleNumber: { increment: 1 }, currentCycleStartDate: new Date() },
      })
    })

    return successResponse({ group: updated, action: 'MONTH_COMPLETED', withdrawnCount: enrollmentsToWithdraw.length })
  }

  // FULL_LEVEL — try the next level in this course first.
  let nextLevel = await prisma.level.findFirst({
    where: { subjectId: group.level.subjectId, order: group.level.order + 1 },
  })
  let sourceCourseFinished = false

  // No next level in this course — the course itself is done. Look for the
  // next course in the same track (only possible if this course has a
  // trackOrder set) and use its first level instead.
  if (!nextLevel && group.level.subject.trackId && group.level.subject.trackOrder != null) {
    const nextCourse = await prisma.academicSubject.findFirst({
      where: { trackId: group.level.subject.trackId, trackOrder: group.level.subject.trackOrder + 1 },
    })
    if (nextCourse) {
      nextLevel = await prisma.level.findFirst({
        where: { subjectId: nextCourse.id },
        orderBy: { order: 'asc' },
      })
      if (nextLevel) sourceCourseFinished = true
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (enrollmentsToWithdraw.length > 0) {
      await tx.studentEnrollment.updateMany({
        where: { id: { in: enrollmentsToWithdraw } },
        data: { status: 'WITHDRAWN' },
      })
    }
    await tx.groupCycleLog.create({
      data: {
        classSectionId: id,
        type: 'LEVEL_COMPLETED',
        levelId: group.levelId,
        completedBy: session.user.id,
      },
    })

    if (!nextLevel) {
      return tx.classSection.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      })
    }

    const expectedEndDate = new Date()
    expectedEndDate.setMonth(expectedEndDate.getMonth() + nextLevel.numberOfMonths)

    return tx.classSection.update({
      where: { id },
      data: {
        levelId: nextLevel.id,
        currentCycleNumber: 1,
        currentCycleStartDate: new Date(),
        startDate: new Date(),
        expectedEndDate,
      },
    })
  })

  return successResponse({
    group: updated,
    action: nextLevel ? 'LEVEL_COMPLETED' : 'GROUP_COMPLETED',
    nextLevel: nextLevel ? { id: nextLevel.id, name: nextLevel.name } : null,
    movedToNextCourse: sourceCourseFinished,
    withdrawnCount: enrollmentsToWithdraw.length,
  })
}
