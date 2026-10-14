/**
 * M1 partners. GET /api/partners — the list (places, active groups, current contract); POST — add a partner.
 * RBAC `partners` (default: Super Admin + Admin; others from the Permissions page).
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { outcome } from '@/lib/partners/http'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { listPartners, savePartner } from '@/lib/partners/engine'
import { partnerSchema } from '@/lib/partners/validation'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'read')
  if (denied) return denied
  return successResponse(await listPartners())
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'create')
  if (denied) return denied
  const parsed = partnerSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const r = await savePartner(session.user.id, null, parsed.data as never)
  if (!r.ok) return outcome(r)
  return createdResponse((r as { value: { id: string } }).value, 'Partner added')
}
