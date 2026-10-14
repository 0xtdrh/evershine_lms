/** M1: GET /api/partners/[id] (details, places, contracts + files) · PATCH (edit / stop) · DELETE (only when empty). */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { deletePartner, getPartner, savePartner } from '@/lib/partners/engine'
import { partnerSchema } from '@/lib/partners/validation'
import { outcome } from '@/lib/partners/http'

type P = { params: Promise<{ id: string }> }

export async function GET(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'read')
  if (denied) return denied
  const p = await getPartner((await params).id)
  return p ? successResponse(p) : errors.notFound('Partner')
}

export async function PATCH(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'update')
  if (denied) return denied
  const parsed = partnerSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return outcome(await savePartner(session.user.id, (await params).id, parsed.data as never), 'Saved')
}

export async function DELETE(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'delete')
  if (denied) return denied
  return outcome(await deletePartner(session.user.id, (await params).id), 'Deleted')
}
