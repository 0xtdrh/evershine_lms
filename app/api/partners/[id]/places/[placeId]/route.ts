/** M1: PATCH /api/partners/[id]/places/[placeId] — edit / stop one place of a partner. */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { updatePlace } from '@/lib/partners/engine'
import { placeSchema } from '@/lib/partners/validation'
import { outcome } from '@/lib/partners/http'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; placeId: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'update')
  if (denied) return denied
  const parsed = placeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const { id, placeId } = await params
  return outcome(await updatePlace(session.user.id, id, placeId, parsed.data as never), 'Saved')
}
