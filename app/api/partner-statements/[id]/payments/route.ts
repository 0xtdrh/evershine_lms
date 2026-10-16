/**
 * Partners part 1-B: POST /api/partner-statements/[id]/payments { direction, amount, method, paidAt, reference?, note? } —
 * money paid on an approved statement (partner → TechNova or TechNova → partner). RBAC `partner_finance:update`.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { addPayment } from '@/lib/partners/statement-engine'
import { statementPaymentSchema } from '@/lib/partners/validation'
import { outcome } from '@/lib/partners/http'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partner_finance', 'update')
  if (denied) return denied
  const parsed = statementPaymentSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return outcome(await addPayment(session.user.id, (await params).id, parsed.data as never), 'Payment recorded')
}
