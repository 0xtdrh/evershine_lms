/** PATCH /api/absence-excuses/[id] { action: approve|reject, note? } — phase C. */

import { canSeeGroup } from '@/lib/places/server'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { decideExcuse } from '@/lib/excuses/engine'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'absence_excuses', 'approve')
  if (denied) return denied
  const { id } = await params
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ action: z.enum(['approve', 'reject']), note: z.string().trim().max(500).optional().nullable() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  {
    // M0: excuses of groups the person may see
    const e = await prisma.absenceExcuse.findUnique({ where: { id }, select: { classSectionId: true } })
    if (e && !(await canSeeGroup(session.user, e.classSectionId))) return errors.forbidden()
  }
  const r = await decideExcuse({ id, action: parsed.data.action, note: parsed.data.note, userId: session.user.id })
  if (!r.ok) return r.code === 404 ? errors.notFound('Excuse') : errors.conflict(r.message)
  return successResponse(r, parsed.data.action === 'approve' ? 'Excuse accepted' : 'Excuse refused')
}
