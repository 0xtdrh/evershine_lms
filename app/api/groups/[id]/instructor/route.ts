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

import { canSeeGroup } from '@/lib/places/server'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errorResponse, errors, successResponse } from '@/lib/api-response'
import { checkTeacherForGroup } from '@/lib/teachers/availability'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import type { Role } from '@prisma/client'

const bodySchema = z.object({ teacherId: z.string().min(1).nullable(), /** a02 batch 4: Super Admin goes ahead against working hours */ force: z.boolean().optional() })

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

  // M0: the group's place (or a single group given to this person)
  if (!(await canSeeGroup(session.user, id))) return errors.forbidden()

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
    // a02 batch 4: his working hours, his other sessions, not two branches the same day (Super Admin may force; logged)
    const problem = await checkTeacherForGroup(parsed.data.teacherId, group)
    if (problem) {
      if (!(parsed.data.force && role === 'SUPER_ADMIN')) return errorResponse('TEACHER_PROBLEM', problem, 409)
      await prisma.auditLog.create({ data: { userId: session.user.id, action: 'FORCE_TEACHER', entityType: 'ClassSection', entityId: id, changes: { teacherId: parsed.data.teacherId, problem } } }).catch(() => undefined)
    }
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
