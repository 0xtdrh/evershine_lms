/**
 * GET  /api/discount-types — all types (managers) or active ones (staff giving discounts)
 * POST /api/discount-types — create a type (discount_types:create)
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { discountTypeSchema } from '@/lib/validation/discounts'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  const canManage = checkPermission(role, 'discount_types', 'read')
  if (!canManage && !checkPermission(role, 'discounts', 'create')) return errors.forbidden()
  const types = await prisma.discountType.findMany({
    where: canManage ? undefined : { isActive: true },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { assignments: true, invoiceDiscounts: true } } },
  })
  return successResponse(types)
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'discount_types', 'create')) return errors.forbidden()
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = discountTypeSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  const type = await prisma.discountType.create({
    data: {
      name: d.name!,
      kind: d.kind!,
      valueType: d.valueType!,
      value: d.value!,
      editableValue: !!d.editableValue,
      maxValue: d.editableValue ? d.maxValue ?? null : null,
      duration: d.duration!,
      autoApply: !!d.autoApply,
      approvalMode: d.approvalMode!,
      scopeType: d.scopeType ?? 'ALL',
      scopeId: d.scopeType && d.scopeType !== 'ALL' ? d.scopeId ?? null : null,
      validFrom: d.validFrom ?? null,
      validTo: d.validTo ?? null,
      stackable: d.stackable !== false,
      isActive: d.isActive !== false,
      createdById: session.user.id,
    },
  })
  return createdResponse(type, 'Discount type created')
}
