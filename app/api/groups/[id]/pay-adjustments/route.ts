/**
 * POST /api/groups/[id]/pay-adjustments
 * Body: { amount, reason, cycleNumber?, teacherId?, substituteAssignmentId? }
 * amount is positive for a bonus, negative for a deduction. Always requires
 * a reason on record. Applies to the given teacherId if provided (e.g. for
 * substitute-coverage reconciliation), otherwise to whichever teacher is
 * currently assigned to this group.
 *
 * DELETE /api/groups/[id]/pay-adjustments?adjustmentId=... removes one
 * (e.g. a bonus/deduction recorded by mistake). Same permission as editing
 * fees, and the adjustment must belong to this group.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, createdResponse, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import type { Role } from '@prisma/client'

const bodySchema = z.object({
  amount: z.number().refine((n) => n !== 0, 'Amount cannot be zero'),
  reason: z.string().min(3, 'Give a short reason'),
  cycleNumber: z.number().int().min(1).optional().nullable(),
  teacherId: z.string().min(1).optional(),
  substituteAssignmentId: z.string().min(1).optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'fees', 'create')
  if (denied) return denied

  const { id } = await params
  const group = await prisma.classSection.findUnique({ where: { id }, select: { campusId: true, currentCycleNumber: true } })
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

  let teacherId = parsed.data.teacherId
  if (!teacherId) {
    const activeYear = await getActiveAcademicYear()
    const offering = activeYear
      ? await prisma.subjectOffering.findFirst({
          where: { classSectionId: id, academicYearId: activeYear.id, teacherId: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { teacherId: true },
        })
      : null
    if (!offering?.teacherId) return errors.conflict('This group has no instructor assigned yet')
    teacherId = offering.teacherId
  }

  // A substitute-coverage event settles each teacher once — guards against a
  // double-tap on Save recording the same bonus/deduction twice.
  if (parsed.data.substituteAssignmentId) {
    const existing = await prisma.teacherPayAdjustment.findFirst({
      where: { teacherId, substituteAssignmentId: parsed.data.substituteAssignmentId },
      select: { id: true },
    })
    if (existing) return errors.conflict('A bonus/deduction is already recorded for this teacher on this session')
  }

  const adjustment = await prisma.teacherPayAdjustment.create({
    data: {
      teacherId,
      classSectionId: id,
      cycleNumber: parsed.data.cycleNumber ?? group.currentCycleNumber,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
      createdBy: session.user.id,
      substituteAssignmentId: parsed.data.substituteAssignmentId,
    },
  })

  return createdResponse(adjustment, 'Adjustment recorded')
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'fees', 'update')
  if (denied) return denied

  const { id } = await params
  const adjustmentId = request.nextUrl.searchParams.get('adjustmentId')
  if (!adjustmentId) {
    return errors.validation({ errors: [{ path: ['adjustmentId'], message: 'adjustmentId is required' }] } as never)
  }

  const adjustment = await prisma.teacherPayAdjustment.findUnique({
    where: { id: adjustmentId },
    include: { classSection: { select: { campusId: true } } },
  })
  if (!adjustment || adjustment.classSectionId !== id) return errors.notFound('Adjustment')

  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && adjustment.classSection?.campusId !== campusId) return errors.forbidden()

  await prisma.teacherPayAdjustment.delete({ where: { id: adjustmentId } })
  return successResponse({ id: adjustmentId, deleted: true })
}
