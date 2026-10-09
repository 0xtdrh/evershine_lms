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
import { onCycleClosed } from '@/lib/groups/cycle-closed'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { createCycleInvoice, syncGroupProgress } from '@/lib/groups/sync-progress'
import type { Role } from '@prisma/client'
import { findGroupInstructorOffering } from '@/lib/groups/instructor'
import { getNextStep } from '@/lib/groups/next-step'

const bodySchema = z.object({
  continuingStudentIds: z.array(z.string()).default([]),
  className: z.string().min(1).max(50).optional(),
  sectionName: z.string().min(1).max(10).optional(),
  /** Super Admin only: close the cycle before all its sessions happened. */
  force: z.boolean().optional(),
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

  // The cycle may only be closed once all its sessions happened. The Groups
  // page hid the button, but the server itself did not check: a stale tab or a
  // wrong click closed a group after 2 of 4 sessions with nobody continuing.
  const progress = await syncGroupProgress(id, session.user.id)
  if (!progress.isLastSessionOfCycle && !(parsed.data.force && role === 'SUPER_ADMIN')) {
    return errors.conflict(
      `This cycle is not finished yet: ${progress.checkedSessionsInCycle} of ${progress.sessionsPerCycle} sessions recorded.`
    )
  }

  // Only students actually in this group can continue (any id used to be accepted).
  const activeIds = new Set(
    (await prisma.studentEnrollment.findMany({ where: { classSectionId: id, status: 'ACTIVE' }, select: { studentId: true } }))
      .map((e) => e.studentId)
  )
  const outsiders = parsed.data.continuingStudentIds.filter((sid) => !activeIds.has(sid))
  if (outsiders.length) return errors.badRequest('Some selected students are not active in this group')

  const level = group.level

  // Work out what's next: another month of the same level, or the next
  // level/course, or nothing (shared rule: lib/groups/next-step.ts).
  const nextStep = await getNextStep(level, group.currentCycleNumber)
  const cycleLogType: 'MONTH_COMPLETED' | 'LEVEL_COMPLETED' = nextStep?.kind === 'NEXT_MONTH' ? 'MONTH_COMPLETED' : 'LEVEL_COMPLETED'

  if (!nextStep) {
    // Nothing comes next — the group (and the track, for this group) is done.
    await prisma.$transaction([
      prisma.classSection.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } }),
      prisma.groupCycleLog.create({
        data: { classSectionId: id, type: 'LEVEL_COMPLETED', levelId: group.levelId, cycleNumber: group.currentCycleNumber, completedBy: session.user.id },
      }),
    ])
    return successResponse({ action: 'GROUP_COMPLETED', newGroupId: null })
  }
  // WHY the level's own subject: when moving to the next course, invoice
  // labels used to show the previous course's name.
  const nextLevel = nextStep.level
  const nextCycleNumber = nextStep.cycleNumber

  // Find the current instructor (if any) to carry over, along with any
  // group-specific pay override.
  const currentOffering = await findGroupInstructorOffering(id, activeYear.id)

  // Guarantee a unique (campus, batch, shift, className, sectionName)
  // combination regardless of why a collision might happen — check first,
  // and add a growing suffix until it's free, instead of hoping the
  // computed name is unique.
  const baseClassName = (parsed.data.className ?? `${group.className.trim()} — ${nextLevel.name.trim()} (${nextCycleNumber})`).slice(0, 50)
  const sectionName = parsed.data.sectionName ?? group.sectionName
  let finalClassName = baseClassName
  let suffix = 2
  while (
    await prisma.classSection.findFirst({
      where: { campusId: group.campusId, batchId: group.batchId, shiftId: group.shiftId, className: finalClassName, sectionName },
      select: { id: true },
    })
  ) {
    finalClassName = `${baseClassName.slice(0, 46)} #${suffix}`
    suffix++
  }

  const newGroup = await prisma.classSection.create({
    data: {
      campusId: group.campusId,
      batchId: group.batchId,
      shiftId: group.shiftId,
      className: finalClassName,
      sectionName,
      levelId: nextLevel.id,
      currentCycleNumber: nextCycleNumber,
      // Both left unset on purpose — the group hasn't actually started
      // until its first real session happens (see lib/groups/cycle-start.ts
      // and the backfill in lib/groups/sync-progress.ts), so there's no
      // real date yet to count expectedEndDate from either.
      currentCycleStartDate: null,
      startDate: null,
      expectedEndDate: null,
      scheduleSlots: group.scheduleSlots ?? undefined,
      requireFullPaymentToStart: group.requireFullPaymentToStart,
      partialPaymentCounts: group.partialPaymentCounts,
      installmentsAllowed: group.installmentsAllowed,
      // LMS L2: the next month of the SAME level keeps reading the same curriculum version and the same way of
      // opening lessons; a new level starts fresh (pinned to its newest published version when it starts).
      ...(nextLevel.id === group.levelId && { curriculumEditionId: group.curriculumEditionId, lessonUnlockMode: group.lessonUnlockMode }),
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

  // Discounts follow the group into its next cycle (each cycle is a new group):
  // group-wide ones move to the new group; a student's discount for this group
  // moves with them if they continue, otherwise it ends. Done BEFORE the new
  // invoices are created so they get the discounts.
  await prisma.discountAssignment.updateMany({
    where: { classSectionId: id, studentId: null, status: { in: ['ACTIVE', 'PENDING'] } },
    data: { classSectionId: newGroup.id },
  })
  await prisma.discountAssignment.updateMany({
    where: { classSectionId: id, studentId: { in: parsed.data.continuingStudentIds }, status: { in: ['ACTIVE', 'PENDING'] } },
    data: { classSectionId: newGroup.id },
  })
  await prisma.discountAssignment.updateMany({
    where: { classSectionId: id, studentId: { notIn: parsed.data.continuingStudentIds }, status: 'ACTIVE' },
    data: { status: 'ENDED', endedAt: new Date(), endedById: session.user.id },
  })

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
  await onCycleClosed(id)

  return successResponse({ action: cycleLogType, newGroupId: newGroup.id })
}
