/**
 * PATCH /api/waiting-list/entries/[id]
 * Body: { status?: 'WAITING' | 'CANCELLED', levelId?: string | null, notes?: string }
 *
 * Cancel / re-open a wish, set the level once decided, or edit notes.
 * (PLACED is set automatically when the student is added to a matching group.)
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import type { Role } from '@prisma/client'

const bodySchema = z.object({
  status: z.enum(['WAITING', 'CANCELLED']).optional(),
  levelId: z.string().min(1).nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'waiting_list', 'update')
  if (denied) return denied

  const { id } = await params
  const entry = await prisma.waitingListEntry.findUnique({ where: { id } })
  if (!entry) return errors.notFound('Waiting list entry')

  const scoped = campusScope(role, session.user.campusId, null)
  if (scoped && entry.campusId !== scoped) return errors.forbidden()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  if (parsed.data.levelId) {
    const level = await prisma.level.findUnique({ where: { id: parsed.data.levelId }, select: { subjectId: true } })
    if (!level || level.subjectId !== entry.subjectId) return errors.badRequest('This level does not belong to the entry\'s course')
  }

  const updated = await prisma.waitingListEntry.update({
    where: { id },
    data: {
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.levelId !== undefined ? { levelId: parsed.data.levelId } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
    },
  })
  return successResponse(updated)
}
