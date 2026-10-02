/**
 * POST /api/discounts/[id]/apply  body { invoiceIds: string[] }
 * The "ask" step: after a discount becomes active, staff choose to apply it to
 * the student's current unpaid invoice(s) too. Each invoice's discounts are
 * recomputed (lib/discounts/engine.ts reapplyDiscountsToInvoice).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { canApproveDiscounts, invoicesAffectedBy, reapplyDiscountsToInvoice } from '@/lib/discounts/engine'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ invoiceIds: z.array(z.string().min(1)).min(1).max(200) })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'discounts', 'create') && !canApproveDiscounts(role)) return errors.forbidden()
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const a = await prisma.discountAssignment.findUnique({ where: { id } })
  if (!a) return errors.notFound('Discount')
  if (a.status !== 'ACTIVE') return errors.conflict('The discount is not active')

  // Only invoices this discount really concerns.
  const allowed = new Set((await invoicesAffectedBy(a)).map((i) => i.id))
  const results: { invoiceId: string; ok: boolean; reason?: string; totalAmount?: number }[] = []
  for (const invoiceId of parsed.data.invoiceIds!) {
    if (!allowed.has(invoiceId)) {
      results.push({ invoiceId, ok: false, reason: 'This invoice is not concerned by the discount' })
      continue
    }
    const r = await reapplyDiscountsToInvoice(invoiceId, session.user.id)
    results.push('reason' in r ? { invoiceId, ok: false, reason: r.reason } : { invoiceId, ok: true, totalAmount: r.totalAmount })
  }
  return successResponse({ results })
}
