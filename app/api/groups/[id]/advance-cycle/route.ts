/**
 * POST /api/groups/[id]/advance-cycle
 * Body: { continuingStudentIds: string[], className?: string, sectionName?: string }
 *
 * The manual step that replaces automatic cycle-closing. Only meant to be
 * called once the group's current cycle has reached its last session (the
 * UI shows this button only then, based on /session-progress).
 *
 * What it does:
 * 1. Marks the CURRENT group COMPLETED — its history (attendance, invoices,
 *    financials) stays exactly as it is, untouched.
 * 2. Works out what comes next: same level's next month (if this wasn't the
 *    level's last month), or the next level / next course in the track (if
 *    it was) — or the group is simply done if nothing comes next.
 * 3. Creates a NEW group for that next month/level, campus/batch/shift and
 *    payment settings carried over, with the SAME instructor assigned.
 * 4. Enrolls only the students in continuingStudentIds into the new group,
 *    and generates their first invoice there.
 * 5. Logs the transition on the old group via GroupCycleLog, linking to the
 *    new group's id.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { createCycleInvoice } from '@/lib/groups/sync-progress'
import type { Role } from '@prisma/client'

const bodySchema = z.object({
  continuingStudentIds: z.array(z.string()).default([]),
  className: z.string().min(1).max(50).optional(),
  sectionName: z.string().min(1).max(10).optional(),
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
    include: { level: { include: { subject: true } } },
  })
  if (!group) return errors.notFound('Group')
  if (!group.level) return errors.conflict('This group has no level set')
  if (group.status === 'COMPLETED') return errors.conflict('This group is already completed')

  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && group.campusId !== campusId) return errors.forbidden()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const activeYear = await getActiveAcademicYear()
  if (!activeYear) return errors.conflict('No active academic year is set')
  const academicYearName = activeYear.name

  const level = group.level

  // Work out what's next: another month of the same level, or the next
  // level/course, or nothing.
  const isLastMonthOfLevel = level.pricingType === 'FULL_LEVEL' || group.currentCycleNumber >= level.numberOfMonths

  let nextLevel = level
  let nextCycleNumber = group.currentCycleNumber + 1
  let cycleLogType: 'MONTH_COMPLETED' | 'LEVEL_COMPLETED' = 'MONTH_COMPLETED'

  if (isLastMonthOfLevel) {
    cycleLogType = 'LEVEL_COMPLETED'
    let found = await prisma.level.findFirst({ where: { subjectId: level.subjectId, order: level.order + 1 } })
    if (!found && level.subject.trackId && level.subject.trackOrder != null) {
      const nextCourse = await prisma.academicSubject.findFirst({
        where: { trackId: level.subject.trackId, trackOrder: level.subject.trackOrder + 1 },
      })
      if (nextCourse) found = await prisma.level.findFirst({ where: { subjectId: nextCourse.id }, orderBy: { order: 'asc' } })
    }
    if (!found) {
      // Nothing comes next — the group (and the track, for this group) is done.
      await prisma.$transaction([
        prisma.classSection.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } }),
        prisma.groupCycleLog.create({
          data: { classSectionId: id, type: 'LEVEL_COMPLETED', levelId: group.levelId, cycleNumber: group.currentCycleNumber, completedBy: session.user.id },
        }),
      ])
      return successResponse({ action: 'GROUP_COMPLETED', newGroupId: null })
    }
    nextLevel = { ...found, subject: level.subject }
    nextCycleNumber = 1
  }

  // Find the current instructor (if any) to carry over, along with any
  // group-specific pay override.
  const currentOffering = await prisma.subjectOffering.findFirst({
    where: { classSectionId: id, academicYearId: activeYear.id, teacherId: { not: null } },
    orderBy: { createdAt: 'desc' },
  })

  const expectedEndDate = new Date()
  expectedEndDate.setMonth(expectedEndDate.getMonth() + nextLevel.numberOfMonths)

  const newGroup = await prisma.classSection.create({
    data: {
      campusId: group.campusId,
      batchId: group.batchId,
      shiftId: group.shiftId,
      className: parsed.data.className ?? group.className,
      sectionName: parsed.data.sectionName ?? group.sectionName,
      levelId: nextLevel.id,
      currentCycleNumber: nextCycleNumber,
      currentCycleStartDate: new Date(),
      startDate: new Date(),
      expectedEndDate,
      scheduleSlots: group.scheduleSlots ?? undefined,
      requireFullPaymentToStart: group.requireFullPaymentToStart,
      partialPaymentCounts: group.partialPaymentCounts,
      installmentsAllowed: group.installmentsAllowed,
    },
  })

  if (currentOffering?.teacherId) {
    await prisma.subjectOffering.create({
      data: {
        academicYearId: activeYear.id,
        classSectionId: newGroup.id,
        subjectId: nextLevel.subjectId,
        teacherId: currentOffering.teacherId,
        overrideFixedAmount: currentOffering.overrideFixedAmount,
        overridePercentOfStudentPayment: currentOffering.overridePercentOfStudentPayment,
        overridePerSessionAmount: currentOffering.overridePerSessionAmount,
      },
    })
  }

  let rollSeed = 1000
  for (const studentId of parsed.data.continuingStudentIds) {
    await prisma.studentEnrollment.create({
      data: {
        studentId,
        academicYearId: activeYear.id,
        classSectionId: newGroup.id,
        rollNumber: String(rollSeed++),
        status: 'ACTIVE',
      },
    })
    await createCycleInvoice({
      studentId,
      classSectionId: newGroup.id,
      levelId: nextLevel.id,
      cycleNumber: nextLevel.pricingType === 'MONTHLY' ? nextCycleNumber : null,
      amount: Number(nextLevel.pricingType === 'MONTHLY' ? nextLevel.monthlyPrice ?? 0 : nextLevel.fullLevelPrice ?? 0),
      academicYearName,
      issuedBy: session.user.id,
      label: nextLevel.pricingType === 'MONTHLY'
        ? `${nextLevel.subject.name} — ${nextLevel.name} — Month ${nextCycleNumber}`
        : `${nextLevel.subject.name} — ${nextLevel.name}`,
    })
  }

  await prisma.classSection.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } })
  await prisma.groupCycleLog.create({
    data: {
      classSectionId: id,
      type: cycleLogType,
      levelId: group.levelId,
      cycleNumber: cycleLogType === 'MONTH_COMPLETED' ? group.currentCycleNumber : null,
      completedBy: session.user.id,
      newClassSectionId: newGroup.id,
    },
  })

  return successResponse({ action: cycleLogType, newGroupId: newGroup.id })
}
