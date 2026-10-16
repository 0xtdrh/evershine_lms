/** Partners part 1-B2: PATCH /api/partner-activities/[id] — edit / mark the follow-up done; DELETE — remove. */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { prisma } from '@/lib/prisma'
import { saveActivity } from '@/lib/partners/relations'
import { activitySchema } from '@/lib/partners/validation'

type P = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'update')
  if (denied) return denied
  const { id } = await params
  const a = await prisma.partnerActivity.findUnique({ where: { id }, select: { partnerId: true } })
  if (!a) return errors.notFound('Activity')
  const parsed = activitySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveActivity(session.user.id, a.partnerId, id, parsed.data as never), 'Saved')
}

export async function DELETE(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'update')
  if (denied) return denied
  const r = await prisma.partnerActivity.deleteMany({ where: { id: (await params).id } })
  return r.count ? successResponse({ deleted: true }) : errors.notFound('Activity')
}
