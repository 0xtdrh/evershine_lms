/**
 * POST /api/groups/[id]/students
 * Body: { studentId }
 * Adds a student to the group. If this student already has a WITHDRAWN
 * enrollment in this exact group (e.g. they were Excluded for non-payment
 * earlier), that enrollment is reactivated instead of creating a new
 * one — so their attendance and grading history, tied to that
 * studentEnrollmentId, is correctly still there when they come back.
 * Otherwise, creates a fresh enrollment as usual.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { generateMissingCycleInvoices } from '@/lib/groups/generate-invoices'
import { errors, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import type { Role } from '@prisma/client'

const bodySchema = z.object({ studentId: z.string().min(1) })

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
  const group = await prisma.classSection.findUnique({ where: { id }, select: { campusId: true, levelId: true, level: { select: { subjectId: true } } } })
  if (!group) return errors.notFound('Group')

  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && group.campusId !== campusId) return errors.forbidden()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const existing = await prisma.studentEnrollment.findFirst({
    where: { studentId: parsed.data.studentId, classSectionId: id },
  })

  let enrollment
  if (existing) {
    if (existing.status === 'ACTIVE') return errors.conflict('This student is already in the group')
    enrollment = await prisma.studentEnrollment.update({
      where: { id: existing.id },
      data: { status: 'ACTIVE', withdrawalReason: null },
    })
  } else {
    const activeYear = await getActiveAcademicYear()
    if (!activeYear) return errors.conflict('No active academic year is set')
    enrollment = await prisma.studentEnrollment.create({
      data: {
        studentId: parsed.data.studentId,
        academicYearId: activeYear.id,
        classSectionId: id,
        rollNumber: String(Math.floor(Math.random() * 9000) + 1000),
      },
    })
  }

  // Waiting list: a wish for this group's course (same level, or level not
  // decided yet) is now fulfilled. Must never break adding the student.
  if (group.level) {
    try {
      await prisma.waitingListEntry.updateMany({
        where: {
          studentId: parsed.data.studentId,
          status: 'WAITING',
          subjectId: group.level.subjectId,
          OR: [{ levelId: null }, { levelId: group.levelId }],
        },
        data: { status: 'PLACED', placedClassSectionId: id, placedAt: new Date() },
      })
    } catch (err) {
      console.error('[WAITING_LIST_MARK_PLACED]', err)
    }
  }

  // Bill the student for the group's current cycle right away (idempotent:
  // skipped if they already have that invoice). Done here so EVERY way of
  // adding a student bills them — the Waiting List "Add to group" did not.
  let billing: { generated: number; skipped: number } | null = null
  try {
    billing = await generateMissingCycleInvoices(id, session.user.id, parsed.data.studentId)
  } catch (err) {
    console.error('[GROUP_ADD_STUDENT_INVOICE]', err)
  }

  return createdResponse({ ...enrollment, billing }, existing ? 'Student re-added — previous history restored' : 'Student added')
}
