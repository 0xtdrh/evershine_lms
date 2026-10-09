/**
 * Agreements (staff, agreements:*).
 * GET  — every agreement with accepted / pending counts (creates the switched-off drafts the first time)
 * POST — new agreement { key, audience, titleEn, titleAr, bodyEn, bodyAr, mandatory?, isActive?, graceDays?, sortOrder? }
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { ensureDraftAgreements } from '@/lib/agreements/engine'
import { agreementSchema } from '@/lib/agreements/schema'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'agreements', 'read')
  if (denied) return denied
  await ensureDraftAgreements(session.user.id)
  const list = await prisma.agreement.findMany({ orderBy: [{ audience: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] })
  const counts = await prisma.agreementAcceptance.groupBy({ by: ['agreementId', 'version'], _count: { _all: true } })
  return successResponse(list.map((a) => ({ ...a, acceptedCurrent: counts.find((c) => c.agreementId === a.id && c.version === a.version)?._count._all ?? 0 })))
}


export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'agreements', 'create')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = agreementSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  if (await prisma.agreement.findUnique({ where: { key: parsed.data.key! } })) return errors.conflict('An agreement with this key already exists')
  const a = await prisma.agreement.create({ data: { ...(parsed.data as Required<typeof parsed.data>), updatedById: session.user.id } })
  return createdResponse(a, 'Agreement created')
}
