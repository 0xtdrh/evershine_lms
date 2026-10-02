/**
 * POST /api/accountant/fees/invoices/[invoiceId]/payments
 * Records a manual payment against an invoice (accountants: own branch only).
 * All the rules and the database writes live in lib/fees/record-payment.ts.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { errors, createdResponse } from '@/lib/api-response'
import { recordPaymentSchema } from '@/lib/validation/accountant-fee'
import { paymentErrorResponse, recordPayment } from '@/lib/fees/record-payment'

export async function POST(request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role
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

  if (role === 'ACCOUNTANT') {
    const [invoice, acc] = await Promise.all([
      prisma.feeInvoice.findUnique({ where: { id: invoiceId }, select: { student: { select: { campusId: true } } } }),
      prisma.accountant.findUnique({ where: { userId: session.user.id }, select: { campusId: true } }),
    ])
    if (!invoice) return errors.notFound('Invoice not found')
    if (invoice.student.campusId !== acc?.campusId) {
      return errors.forbidden('Cannot record payment for a student in a different campus')
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
