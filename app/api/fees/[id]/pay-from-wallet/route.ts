/**
 * POST /api/fees/[id]/pay-from-wallet { amount? } — pay an invoice from the
 * student's wallet (fees:update or fee_collection:create). Goes through
 * recordPayment (receipt, rules) with the wallet debit in the same transaction.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { createdResponse, errors } from '@/lib/api-response'
import { paymentErrorResponse } from '@/lib/fees/record-payment'
import { payFromWallet } from '@/lib/refunds/engine'

const bodySchema = z.object({ amount: z.number().positive().optional() })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'fees', 'update') && !checkPermission(role, 'fee_collection', 'create')) return errors.forbidden()
  const { id } = await params
  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const r = await payFromWallet(id, session.user.id, parsed.data.amount)
  if ('code' in r) return paymentErrorResponse(r)
  return createdResponse(
    { id: r.payment.id, receiptNumber: r.receiptNumber, amount: r.amount, newStatus: r.invoiceStatus },
    `Paid ${r.amount} EGP from the wallet`
  )
}
