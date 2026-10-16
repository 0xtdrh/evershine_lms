/** Partners part 1: GET /api/partners/[id]/deals — the money deals of a partner; POST — add one (built from pieces). */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { listDeals, saveDeal } from '@/lib/partners/deal-engine'
import { dealSchema } from '@/lib/partners/validation'
import { outcome } from '@/lib/partners/http'

type P = { params: Promise<{ id: string }> }

export async function GET(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'read')
  if (denied) return denied
  return successResponse(await listDeals((await params).id))
}

export async function POST(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'update')
  if (denied) return denied
  const parsed = dealSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const r = await saveDeal(session.user.id, (await params).id, null, parsed.data as never)
  if (!r.ok) return outcome(r)
  return createdResponse((r as { value: { id: string } }).value, 'Deal saved')
}
