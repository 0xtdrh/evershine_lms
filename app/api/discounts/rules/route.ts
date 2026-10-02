/**
 * GET/PUT /api/discounts/rules — stacking on/off, maximum total %, sibling rule.
 * Permission: finance_settings (read / update).
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { discountRulesSchema } from '@/lib/validation/discounts'
import { getDiscountRules, saveDiscountRules } from '@/lib/discounts/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'finance_settings', 'read') && !checkPermission(role, 'discount_types', 'read')) return errors.forbidden()
  return successResponse(await getDiscountRules())
}

export async function PUT(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'finance_settings', 'update')) return errors.forbidden()
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = discountRulesSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const v = {
    allowStacking: !!parsed.data.allowStacking,
    maxTotalPercent: parsed.data.maxTotalPercent ?? null,
    siblingAppliesTo: parsed.data.siblingAppliesTo === 'ALL' ? ('ALL' as const) : ('SECOND_AND_LATER' as const),
  }
  await saveDiscountRules(v, session.user.id)
  return successResponse(v, 'Saved')
}
