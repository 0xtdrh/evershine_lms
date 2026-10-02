/**
 * PATCH /api/discounts/[id]  body { action: 'approve' | 'reject' | 'end', reason? }
 *  approve / reject: discount_approvals:approve, only while PENDING
 *  end: stops the discount from the next invoice (discounts:update or a manager)
 * After approve, the response lists unpaid invoices it could apply to (ask step).
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { logAudit } from '@/lib/audit-logger'
import { discountActionSchema } from '@/lib/validation/discounts'
import { canApproveDiscounts, invoicesAffectedBy } from '@/lib/discounts/engine'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = discountActionSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const { action, reason } = parsed.data

  const a = await prisma.discountAssignment.findUnique({ where: { id }, include: { discountType: true } })
  if (!a) return errors.notFound('Discount')

  if (action === 'approve' || action === 'reject') {
    if (!canApproveDiscounts(role)) return errors.forbidden('Only a manager can approve discounts')
    if (a.status !== 'PENDING') return errors.conflict('This request was already handled')
  } else {
    if (!checkPermission(role, 'discounts', 'update') && !canApproveDiscounts(role)) return errors.forbidden()
    if (a.status !== 'ACTIVE' && a.status !== 'PENDING') return errors.conflict('This discount is not active')
  }

  const now = new Date()
  const updated = await prisma.discountAssignment.update({
    where: { id },
    data:
      action === 'approve'
        ? { status: 'ACTIVE', approvedById: session.user.id, approvedAt: now }
        : action === 'reject'
          ? { status: 'REJECTED', rejectedReason: reason ?? null, approvedById: session.user.id, approvedAt: now }
          : { status: 'ENDED', endedAt: now, endedById: session.user.id },
  })

  try {
    await logAudit({
      prismaClient: prisma,
      userId: session.user.id,
      action: 'UPDATE',
      entityType: 'DiscountAssignment',
      entityId: id,
      changes: { action, reason, type: a.discountType.name },
      request,
    })
  } catch (err) {
    console.error('[DISCOUNT_AUDIT]', err)
  }
  try {
    if (action !== 'end' && a.requestedById !== session.user.id) {
      await prisma.notification.create({
        data: {
          userId: a.requestedById,
          title: action === 'approve' ? 'Discount approved' : 'Discount rejected',
          message: `${a.discountType.name}${reason ? ` — ${reason}` : ''}`,
          type: 'DISCOUNT_REQUEST',
          relatedId: id,
        },
      })
    }
  } catch (err) {
    console.error('[DISCOUNT_NOTIFY]', err)
  }

  const affectedInvoices = action === 'approve' ? await invoicesAffectedBy(updated) : []
  return successResponse({ assignment: updated, affectedInvoices })
}
