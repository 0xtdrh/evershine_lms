/** M1: POST /api/partners/[id]/places — a new place of this partner (a Campus with kind PARTNER). */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { addPlace } from '@/lib/partners/engine'
import { placeSchema } from '@/lib/partners/validation'
import { outcome } from '@/lib/partners/http'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'update')
  if (denied) return denied
  const parsed = placeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return outcome(await addPlace(session.user.id, (await params).id, parsed.data as never), 'Place added')
}
