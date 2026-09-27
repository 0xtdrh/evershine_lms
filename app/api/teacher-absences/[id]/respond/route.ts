/**
 * POST /api/teacher-absences/[id]/respond
 * Body: { decision: 'APPROVE' | 'REJECT', rejectionReason? }
 * Gated by the 'teacher_absences' RBAC resource's 'approve' action — not a
 * hardcoded role, so who can approve is configurable via the Permissions
 * page. Notifies the requesting teacher either way.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import type { Role } from '@prisma/client'

const bodySchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().max(500).optional(),
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
    include: { teacher: { select: { id: true, userId: true, firstName: true, lastName: true } } },
  })
  if (!absence) return errors.notFound('Absence request')
  if (absence.status !== 'PENDING') return errors.conflict('This request has already been responded to')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const updated = await prisma.teacherAbsence.update({
    where: { id },
    data: {
      status: parsed.data.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      respondedBy: session.user.id,
      respondedAt: new Date(),
      rejectionReason: parsed.data.decision === 'REJECT' ? parsed.data.rejectionReason ?? null : null,
    },
  })

  try {
    await prisma.notification.create({
      data: {
        userId: absence.teacher.userId,
        title: parsed.data.decision === 'APPROVE' ? 'Absence request approved' : 'Absence request rejected',
        message: parsed.data.decision === 'APPROVE'
          ? `Your absence request for ${absence.date.toISOString().slice(0, 10)} was approved.`
          : `Your absence request for ${absence.date.toISOString().slice(0, 10)} was rejected.${parsed.data.rejectionReason ? ` Reason: ${parsed.data.rejectionReason}` : ''}`,
        type: parsed.data.decision === 'APPROVE' ? 'TEACHER_ABSENCE_APPROVED' : 'TEACHER_ABSENCE_REJECTED',
        relatedId: absence.id,
      },
    })
  } catch (notifErr) {
    console.error('[TEACHER_ABSENCE_RESPOND] notification failed:', notifErr)
  }

  return successResponse(updated)
}
