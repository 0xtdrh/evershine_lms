/**
 * GET   /api/groups/[id]  — full group detail: course/level/track, campus,
 *                            teacher, dates, schedule, and the student roster.
 * PATCH /api/groups/[id]  — update dates, weekly schedule, status
 *                            (Active/Completed), or which level it belongs to.
 *                            Teacher assignment stays in the existing
 *                            Subject Offerings flow — not duplicated here.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import type { Role } from '@prisma/client'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'read')
  if (denied) return denied

  const { id } = await params
  const group = await prisma.classSection.findUnique({
    where: { id },
    include: {
      campus: { select: { id: true, name: true } },
      batch: { select: { id: true, name: true } },
      shift: { select: { id: true, name: true } },
      level: {
        select: {
          id: true,
          name: true,
          numberOfMonths: true,
          numberOfSessions: true,
          pricingType: true,
          monthlyPrice: true,
          fullLevelPrice: true,
          subject: { select: { id: true, name: true, track: { select: { id: true, name: true } } } },
        },
      },
      subjectOfferings: {
        take: 1,
        select: { teacher: { select: { id: true, firstName: true, lastName: true, phoneNumber: true, email: true } } },
      },
      enrollments: {
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          rollNumber: true,
          student: { select: { id: true, firstName: true, lastName: true, fullNameEn: true, registrationNumber: true } },
        },
        orderBy: { rollNumber: 'asc' },
      },
    },
  })
  if (!group) return errors.notFound('Group')

  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && group.campusId !== campusId) return errors.forbidden()

  return successResponse({ ...group, label: `${group.className} ${group.sectionName}`.trim() })
}

const updateGroupSchema = z.object({
  campusId: z.string().min(1).optional(),
  batchId: z.string().min(1).optional(),
  shiftId: z.string().min(1).optional(),
  className: z.string().min(1).max(50).optional(),
  sectionName: z.string().min(1).max(10).optional(),
  levelId: z.string().min(1).optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  expectedEndDate: z.string().datetime().optional().nullable(),
  scheduleSlots: z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), time: z.string().min(1) })).optional().nullable(),
  status: z.enum(['ACTIVE', 'COMPLETED']).optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'update')
  if (denied) return denied

  const { id } = await params
  const existing = await prisma.classSection.findUnique({ where: { id } })
  if (!existing) return errors.notFound('Group')

  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && existing.campusId !== campusId) return errors.forbidden()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }

  const parsed = updateGroupSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  if (parsed.data.levelId) {
    const level = await prisma.level.findUnique({ where: { id: parsed.data.levelId }, select: { id: true } })
    if (!level) return errors.notFound('Level')
  }

  const group = await prisma.classSection.update({
    where: { id },
    data: {
      ...(parsed.data.campusId !== undefined && { campusId: parsed.data.campusId }),
      ...(parsed.data.batchId !== undefined && { batchId: parsed.data.batchId }),
      ...(parsed.data.shiftId !== undefined && { shiftId: parsed.data.shiftId }),
      ...(parsed.data.className !== undefined && { className: parsed.data.className }),
      ...(parsed.data.sectionName !== undefined && { sectionName: parsed.data.sectionName }),
      ...(parsed.data.levelId !== undefined && { levelId: parsed.data.levelId }),
      ...(parsed.data.startDate !== undefined && { startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null }),
      ...(parsed.data.expectedEndDate !== undefined && { expectedEndDate: parsed.data.expectedEndDate ? new Date(parsed.data.expectedEndDate) : null }),
      ...(parsed.data.scheduleSlots !== undefined && { scheduleSlots: parsed.data.scheduleSlots }),
      ...(parsed.data.status && {
        status: parsed.data.status,
        completedAt: parsed.data.status === 'COMPLETED' ? new Date() : null,
      }),
    },
  })

  return successResponse(group)
}

/**
 * DELETE /api/groups/[id]
 * Soft-delete only (isActive=false) — a ClassSection can be referenced by
 * attendance, grading, timetable and exam records, so it is never hard
 * deleted. Blocked entirely while it still has active students; remove or
 * transfer them first.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'delete')
  if (denied) return denied

  const { id } = await params
  const existing = await prisma.classSection.findUnique({
    where: { id },
    include: { _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
  })
  if (!existing) return errors.notFound('Group')

  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && existing.campusId !== campusId) return errors.forbidden()

  if (existing._count.enrollments > 0) {
    return errors.conflict('This group still has active students — remove or transfer them before deleting it')
  }

  await prisma.classSection.update({ where: { id }, data: { isActive: false } })

  return successResponse({ id, deleted: true })
}
