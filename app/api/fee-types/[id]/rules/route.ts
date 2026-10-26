/** POST /api/fee-types/[id]/rules { scopeType, scopeId, mode, amount?, frequency?, onUnpaid? } — FIN-2: an exception for a place / partner / track / course / level / group / student. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors } from '@/lib/api-response'
import { createdResponse } from '@/lib/api-response'
import { saveFeeRule } from '@/lib/fees-extra/engine'
import { FEE_FREQUENCIES, FEE_MODES, FEE_SCOPES, ON_UNPAID } from '@/lib/fees-extra/rules'
import { withMonthLock } from '@/lib/month-close/with-lock'

const schema = z.object({
  scopeType: z.enum(FEE_SCOPES), scopeId: z.string().min(1).max(40), mode: z.enum(FEE_MODES), amount: z.number().min(0).max(1000000).optional().nullable(),
  frequency: z.enum(FEE_FREQUENCIES).optional().nullable(), onUnpaid: z.enum(ON_UNPAID).optional().nullable(),
})

async function POST_(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'finance_settings', 'update')) return errors.forbidden()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return createdResponse(await saveFeeRule((await params).id, parsed.data as { scopeType: string; scopeId: string; mode: string; amount?: number | null; frequency?: string | null; onUnpaid?: string | null }))
}

// a03: a write into a closed month answers 409 with the reason
export const POST = withMonthLock(POST_)
