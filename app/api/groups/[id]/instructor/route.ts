/**
 * POST /api/groups/[id]/instructor
 * Body: { teacherId: string | null }
 *
 * Assigns/changes/unassigns the group's instructor. Wraps the existing
 * SubjectOffering (classSection + course + academic year + teacher) — a
 * group's course must already be set (via its level). If an offering for
 * this group/course/year already exists, its teacherId is updated; otherwise
 * a new one is created.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import type { Role } from '@prisma/client'

const bodySchema = z.object({ teacherId: z.string().min(1).nullable() })

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'subject_offerings', 'update')
  if (denied) return denied

  const { id } = await params
  const group = await prisma.classSection.findUnique({ where: { id }, include: { level: true } })
  if (!group) return errors.notFound('Group')

  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && group.campusId !== campusId) return errors.forbidden()

  if (!group.level) {
    return errors.conflict('This group has no course/level assigned yet — set one before assigning an instructor')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  if (parsed.data.teacherId) {
    const teacher = await prisma.teacher.findUnique({ where: { id: parsed.data.teacherId }, select: { id: true } })
    if (!teacher) return errors.notFound('Teacher')
  }

  const activeYear = await getActiveAcademicYear()
  if (!activeYear) return errors.conflict('No active academic year is set')

  const existingOffering = await prisma.subjectOffering.findFirst({
    where: { classSectionId: id, subjectId: group.level.subjectId, academicYearId: activeYear.id },
  })

  const offering = existingOffering
    ? await prisma.subjectOffering.update({
        where: { id: existingOffering.id },
        data: { teacherId: parsed.data.teacherId },
      })
    : await prisma.subjectOffering.create({
        data: {
          academicYearId: activeYear.id,
          classSectionId: id,
          subjectId: group.level.subjectId,
          teacherId: parsed.data.teacherId,
        },
      })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: existingOffering ? 'UPDATE' : 'CREATE',
      entityType: 'SubjectOffering',
      entityId: offering.id,
      changes: { teacherId: parsed.data.teacherId, viaGroupInstructorAssign: true },
    },
  })

  return successResponse(offering)
}
