/**
 * POST /api/substitute-assignments/[id]/respond
 * Body: { decision: 'ACCEPT' | 'DECLINE' }
 * Only the substitute themselves (or an admin acting for them) can respond.
 * Accepting is what makes the assignment show up in anyone's schedule.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { notifySubstitute } from '@/lib/notifications/session-events'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { getTeacherByUserId } from '@/lib/academic/teacher-scope'
import type { Role } from '@prisma/client'

const bodySchema = z.object({ decision: z.enum(['ACCEPT', 'DECLINE']) })

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role

  const { id } = await params
  const assignment = await prisma.substituteAssignment.findUnique({
    where: { id },
    include: {
      originalTeacher: { select: { userId: true, firstName: true, lastName: true } },
      substituteTeacher: { select: { id: true, userId: true } },
      classSection: { select: { className: true, sectionName: true } },
    },
  })
  if (!assignment) return errors.notFound('Substitute assignment')
  if (assignment.status !== 'PENDING_SUBSTITUTE_APPROVAL') return errors.conflict('This assignment has already been responded to')

  if (role === 'TEACHER') {
    const teacher = await getTeacherByUserId(session.user.id)
    if (!teacher || teacher.id !== assignment.substituteTeacherId) return errors.forbidden()
  } else {
    const denied = requirePermission(role, 'teacher_absences', 'update')
    if (denied) return denied
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const updated = await prisma.substituteAssignment.update({
    where: { id },
    data: {
      status: parsed.data.decision === 'ACCEPT' ? 'CONFIRMED' : 'DECLINED',
      respondedAt: new Date(),
    },
  })

  try {
    await prisma.notification.create({
      data: {
        userId: assignment.originalTeacher.userId,
        title: parsed.data.decision === 'ACCEPT' ? 'Substitute confirmed' : 'Substitute declined',
        message: parsed.data.decision === 'ACCEPT'
          ? `Your session for ${assignment.classSection.className} ${assignment.classSection.sectionName} on ${assignment.date.toISOString().slice(0, 10)} is covered.`
          : `The substitute declined your session for ${assignment.classSection.className} ${assignment.classSection.sectionName} on ${assignment.date.toISOString().slice(0, 10)} — a new substitute is needed.`,
        type: parsed.data.decision === 'ACCEPT' ? 'SUBSTITUTE_CONFIRMED' : 'SUBSTITUTE_DECLINED',
        relatedId: assignment.id,
      },
    })
  } catch (notifErr) {
    console.error('[SUBSTITUTE_RESPOND] notification failed:', notifErr)
  }

  if (parsed.data.decision === 'ACCEPT') await notifySubstitute(updated.classSectionId, updated.date.toISOString().slice(0, 10))
  return successResponse(updated)
}
