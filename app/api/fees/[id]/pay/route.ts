/**
 * POST /api/fees/[id]/pay — record a payment against a fee invoice.
 * All the rules and the database writes live in lib/fees/record-payment.ts.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { errors, createdResponse } from '@/lib/api-response'
import { recordPaymentSchema } from '@/lib/validation/fee'
import { paymentErrorResponse, recordPayment } from '@/lib/fees/record-payment'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'fees', 'create')) return errors.forbidden()

  const { id: invoiceId } = await params
  let body: unknown
  try { body = await request.json() } catch { return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never) }

  const parsed = recordPaymentSchema.safeParse({ ...(body as Record<string, unknown>), invoiceId })
  if (!parsed.success) return errors.validation(parsed.error)
  const { amount, paymentMethod, transactionId, paymentDate, remarks } = parsed.data

  const r = await recordPayment({
    invoiceId,
    amount: amount!,
    method: paymentMethod!,
    source: 'STAFF',
    receivedBy: session.user.id,
    transactionId: transactionId ?? null,
    remarks: remarks ?? null,
    paymentDate: paymentDate ? new Date(paymentDate) : undefined,
  })
  if ('code' in r) return paymentErrorResponse(r)
  return createdResponse(r.payment, `Payment of ${r.amount} recorded successfully`)
}
