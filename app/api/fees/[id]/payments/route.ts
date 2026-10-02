/**
 * POST /api/fees/[id]/payments — record a payment against an invoice.
 * All the rules and the database writes live in lib/fees/record-payment.ts.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, createdResponse } from '@/lib/api-response'
import { paymentErrorResponse, recordPayment } from '@/lib/fees/record-payment'

const paymentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  paymentMethod: z.string().trim().min(1, 'Choose a payment method').max(50),
  transactionId: z.string().optional(),
  remarks: z.string().optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'fees', 'update')) return errors.forbidden()

  const { id: invoiceId } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }
  const parsed = paymentSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const { amount, paymentMethod, transactionId, remarks } = parsed.data

  const r = await recordPayment({
    invoiceId,
    amount: amount!,
    method: paymentMethod!,
    source: 'STAFF',
    receivedBy: session.user.id,
    transactionId: transactionId ?? null,
    remarks: remarks ?? null,
  })
  if ('code' in r) return paymentErrorResponse(r)
  return createdResponse(
    { id: r.payment.id, invoiceId, amount: r.amount, newStatus: r.invoiceStatus, receiptNumber: r.receiptNumber },
    `Payment of EGP ${r.amount} recorded successfully`
  )
}
