/** Partners part 1-B2: PATCH /api/partner-contacts/[id] — edit a contact; DELETE — remove it. */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { prisma } from '@/lib/prisma'
import { saveContact } from '@/lib/partners/relations'
import { contactSchema } from '@/lib/partners/validation'

type P = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'update')
  if (denied) return denied
  const { id } = await params
  const c = await prisma.partnerContact.findUnique({ where: { id }, select: { partnerId: true } })
  if (!c) return errors.notFound('Contact')
  const parsed = contactSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveContact(c.partnerId, id, parsed.data as never), 'Saved')
}

export async function DELETE(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'update')
  if (denied) return denied
  const r = await prisma.partnerContact.deleteMany({ where: { id: (await params).id } })
  return r.count ? successResponse({ deleted: true }) : errors.notFound('Contact')
}
