/**
 * POST /api/accountant/fees/invoices/[invoiceId]/payments
 * Records a manual payment against an invoice (accountants: own branch only).
 * All the rules and the database writes live in lib/fees/record-payment.ts.
 */

import { canSeeInvoice } from '@/lib/places/server'
import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { errors, createdResponse } from '@/lib/api-response'
import { recordPaymentSchema } from '@/lib/validation/accountant-fee'
import { paymentErrorResponse, recordPayment } from '@/lib/fees/record-payment'
import { withMonthLock } from '@/lib/month-close/with-lock'

async function POST_(request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role, 'fee_collection', 'create')) {
    return errors.forbidden()
  }

  const { invoiceId } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON body' }] } as never)
  }
  const parsed = recordPaymentSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const data = parsed.data

  // M0: payments on invoices of the person's places only
  {
    const invoice = await prisma.feeInvoice.findUnique({ where: { id: invoiceId }, select: { id: true } })
    if (!invoice) return errors.notFound('Invoice not found')
    if (!(await canSeeInvoice(session.user, invoiceId))) {
      return errors.forbidden('Cannot record payment for an invoice outside your places')
    }
  }

  const r = await recordPayment({
    invoiceId,
    amount: data.amount!,
    method: data.paymentMethod!,
    source: 'STAFF',
    receivedBy: session.user.id,
    transactionId: data.transactionId ?? null,
    remarks: data.remarks ?? null,
    paymentDate: data.paymentDate ? new Date(data.paymentDate) : undefined,
  })
  if ('code' in r) return paymentErrorResponse(r)
  return createdResponse(r.payment, 'Payment recorded successfully')
}

// a03: a write into a closed month answers 409 with the reason
export const POST = withMonthLock(POST_)
