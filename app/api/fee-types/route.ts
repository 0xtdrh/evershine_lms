/** GET /api/fee-types — FIN-2 fee types with their rules; POST — add one (Settings: finance_settings update). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors } from '@/lib/api-response'
import { createdResponse, successResponse } from '@/lib/api-response'
import { listFeeTypes, saveFeeType, type FeeTypeInput } from '@/lib/fees-extra/engine'
import { FEE_FREQUENCIES, ON_UNPAID } from '@/lib/fees-extra/rules'

export const dynamic = 'force-dynamic'

const feeTypeSchema = z.object({
  nameEn: z.string().trim().min(2).max(80), nameAr: z.string().trim().min(2).max(80), amount: z.number().min(0).max(1000000),
  frequency: z.enum(FEE_FREQUENCIES), isPlatform: z.boolean().optional(), defaultMode: z.enum(['REQUIRED', 'OPTIONAL']).optional(),
  onUnpaid: z.enum(ON_UNPAID).optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().optional(),
})

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role, 'fees', 'read')) return errors.forbidden()
  return successResponse(await listFeeTypes())
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'finance_settings', 'update')) return errors.forbidden()
  const parsed = feeTypeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return createdResponse(await saveFeeType(parsed.data as FeeTypeInput))
}
