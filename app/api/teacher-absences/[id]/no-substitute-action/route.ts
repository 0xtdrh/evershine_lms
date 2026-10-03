/**
 * POST /api/teacher-absences/[id]/no-substitute-action
 * Body: { classSectionId, action: 'CONTINUE' | 'CANCEL_SESSION', reason? }
 * Used when no qualified & available substitute was found for one of an
 * absence's affected sessions. CONTINUE just closes the "needs substitute"
 * state without assigning anyone. CANCEL_SESSION records that this specific
 * session isn't happening, visible wherever the group's schedule is shown.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { notifySessionCancelled } from '@/lib/notifications/session-events'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import type { Role } from '@prisma/client'

const bodySchema = z.object({
  classSectionId: z.string().min(1),
  action: z.enum(['CONTINUE', 'CANCEL_SESSION']),
  reason: z.string().max(500).optional(),
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
  const absence = await prisma.teacherAbsence.findUnique({ where: { id } })
  if (!absence) return errors.notFound('Absence request')
  if (absence.status !== 'APPROVED') return errors.conflict('The absence must be approved first')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  if (parsed.data.action === 'CANCEL_SESSION') {
    const cancelled = await prisma.cancelledSession.upsert({
      where: { classSectionId_date: { classSectionId: parsed.data.classSectionId, date: absence.date } },
      create: {
        classSectionId: parsed.data.classSectionId,
        date: absence.date,
        reason: parsed.data.reason ?? `No substitute available — ${absence.reason}`,
        cancelledBy: session.user.id,
      },
      update: {},
    })
    await notifySessionCancelled(parsed.data.classSectionId, absence.date.toISOString().slice(0, 10))
    return successResponse({ action: 'CANCEL_SESSION', cancelledSession: cancelled })
  }

  return successResponse({ action: 'CONTINUE' })
}
