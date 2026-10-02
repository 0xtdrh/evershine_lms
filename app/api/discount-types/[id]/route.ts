/**
 * PATCH  /api/discount-types/[id] — edit a type (discount_types:update)
 * DELETE /api/discount-types/[id] — delete if never used, otherwise deactivate
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { discountTypeSchema } from '@/lib/validation/discounts'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'discount_types', 'update')) return errors.forbidden()
  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = discountTypeSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  const existing = await prisma.discountType.findUnique({ where: { id } })
  if (!existing) return errors.notFound('Discount type')
  // Changing a type affects NEW invoices only; invoices already issued keep
  // their recorded discount lines.
  const type = await prisma.discountType.update({
    where: { id },
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
    },
  })
  return successResponse(type, 'Saved')
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'discount_types', 'delete')) return errors.forbidden()
  const { id } = await params
  const type = await prisma.discountType.findUnique({
    where: { id },
    include: { _count: { select: { assignments: true, invoiceDiscounts: true } } },
  })
  if (!type) return errors.notFound('Discount type')
  if (type._count.assignments > 0 || type._count.invoiceDiscounts > 0) {
    // Keep history (reports, old invoices): switch it off instead.
    await prisma.discountType.update({ where: { id }, data: { isActive: false } })
    return successResponse({ deactivated: true }, 'This type was already used, so it was switched off instead of deleted')
  }
  await prisma.discountType.delete({ where: { id } })
  return successResponse({ deleted: true }, 'Deleted')
}
