/** Partners part 1-B2: GET /api/partners/[id]/report?from&to — what happened at the partner's places (printable report). */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { partnerReport } from '@/lib/partners/insights'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partners', 'read')
  if (denied) return denied
  const sp = new URL(request.url).searchParams
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  if (!DATE.test(from) || !DATE.test(to) || to < from) return errors.badRequest('Choose the period (from / to)')
  const r = await partnerReport((await params).id, new Date(`${from}T00:00:00.000Z`), new Date(`${to}T00:00:00.000Z`))
  return r ? successResponse(r) : errors.notFound('Partner')
}
