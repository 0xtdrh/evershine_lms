/** PATCH /api/fee-types/[id] — FIN-2: edit a fee type (amount, frequency, required / optional, what happens if unpaid). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors } from '@/lib/api-response'
import { successResponse } from '@/lib/api-response'
import { saveFeeType, type FeeTypeInput } from '@/lib/fees-extra/engine'
import { FEE_FREQUENCIES, ON_UNPAID } from '@/lib/fees-extra/rules'

const schema = z.object({
  nameEn: z.string().trim().min(2).max(80), nameAr: z.string().trim().min(2).max(80), amount: z.number().min(0).max(1000000),
  frequency: z.enum(FEE_FREQUENCIES), isPlatform: z.boolean().optional(), defaultMode: z.enum(['REQUIRED', 'OPTIONAL']).optional(),
  onUnpaid: z.enum(ON_UNPAID).optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'finance_settings', 'update')) return errors.forbidden()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveFeeType(parsed.data as FeeTypeInput, (await params).id))
}
