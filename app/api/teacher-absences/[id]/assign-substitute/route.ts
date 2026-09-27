/**
 * POST /api/teacher-absences/[id]/assign-substitute
 * Body: { classSectionId, substituteTeacherId }
 * Creates the assignment as PENDING_SUBSTITUTE_APPROVAL — it isn't
 * confirmed (and doesn't show up in anyone's schedule) until the
 * substitute accepts via /api/substitute-assignments/[id]/respond.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import type { Role } from '@prisma/client'

const bodySchema = z.object({
  classSectionId: z.string().min(1),
  substituteTeacherId: z.string().min(1),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'teacher_absences', 'approve')
  if (denied) return denied

  const { id } = await params
  const absence = await prisma.teacherAbsence.findUnique({
    where: { id },
    include: { teacher: { select: { firstName: true, lastName: true } } },
  })
  if (!absence) return errors.notFound('Absence request')
  if (absence.status !== 'APPROVED') return errors.conflict('The absence must be approved before assigning a substitute')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  if (parsed.data.substituteTeacherId === absence.teacherId) {
    return errors.conflict('The substitute cannot be the same teacher who is absent')
  }

  const existing = await prisma.substituteAssignment.findFirst({
    where: { teacherAbsenceId: id, classSectionId: parsed.data.classSectionId, status: { not: 'DECLINED' } },
  })
  if (existing) return errors.conflict('This session already has a substitute assigned or pending')

  const substitute = await prisma.teacher.findUnique({ where: { id: parsed.data.substituteTeacherId }, select: { id: true, userId: true } })
  if (!substitute) return errors.notFound('Substitute teacher')

  const assignment = await prisma.substituteAssignment.create({
    data: {
      teacherAbsenceId: id,
      classSectionId: parsed.data.classSectionId,
      date: absence.date,
      originalTeacherId: absence.teacherId,
      substituteTeacherId: parsed.data.substituteTeacherId,
      assignedBy: session.user.id,
    },
  })

  try {
    await prisma.notification.create({
      data: {
        userId: substitute.userId,
        title: 'Substitute session request',
        message: `You're requested to cover a session for ${absence.teacher.firstName} ${absence.teacher.lastName} on ${absence.date.toISOString().slice(0, 10)}. Please accept or decline in My Substitutions.`,
        type: 'SUBSTITUTE_REQUESTED',
        relatedId: assignment.id,
      },
    })
  } catch (notifErr) {
    console.error('[ASSIGN_SUBSTITUTE] notification failed:', notifErr)
  }

  return createdResponse(assignment, 'Substitute requested — awaiting their acceptance')
}
