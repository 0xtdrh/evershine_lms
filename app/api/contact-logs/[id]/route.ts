/**
 * PATCH /api/contact-logs/[id] { followUpDone?: boolean, followUpAt?: ISO | null }
 * Mark a follow-up done (or move it).
 */

import { canSeeStudent } from '@/lib/places/server'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'

const bodySchema = z.object({
  followUpDone: z.boolean().optional(),
  followUpAt: z.string().datetime().nullable().optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'contact_logs', 'update')
  if (denied) return denied
  const { id } = await params
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const row = await prisma.contactLog.findUnique({ where: { id }, select: { campusId: true, studentId: true } })
  if (!row) return errors.notFound('Contact')
  if (!(await canSeeStudent(session.user, row.studentId))) return errors.forbidden()
  const updated = await prisma.contactLog.update({
    where: { id },
    data: {
      ...(parsed.data.followUpDone !== undefined && { followUpDoneAt: parsed.data.followUpDone ? new Date() : null }),
      ...(parsed.data.followUpAt !== undefined && { followUpAt: parsed.data.followUpAt ? new Date(parsed.data.followUpAt) : null }),
    },
  })
  return successResponse({ id: updated.id, followUpAt: updated.followUpAt, followUpDoneAt: updated.followUpDoneAt })
}
