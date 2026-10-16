/** Partners part 1: PATCH /api/partner-deals/[id] — edit a deal (or stop it with isActive:false). */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { prisma } from '@/lib/prisma'
import { saveDeal } from '@/lib/partners/deal-engine'
import { dealSchema } from '@/lib/partners/validation'
import { outcome } from '@/lib/partners/http'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'update')
  if (denied) return denied
  const { id } = await params
  const d = await prisma.partnerDeal.findUnique({ where: { id }, select: { partnerId: true } })
  if (!d) return errors.notFound('Deal')
  const parsed = dealSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return outcome(await saveDeal(session.user.id, d.partnerId, id, parsed.data as never), 'Saved')
}
