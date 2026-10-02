import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { paymentErrorResponse, recordPayment } from '@/lib/fees/record-payment'
import { PROOF_METHOD } from '@/lib/fees/payment-settings'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { z } from 'zod'
import type { Role, InvoiceStatus } from '@prisma/client'

const verifyProofSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  remarks: z.string().max(500).optional(),
  /** Optional: exact amount student paid (for partial approval). Defaults to full remaining balance. */
  paidAmount: z.number().positive('Paid amount must be greater than zero').optional(),
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

  const parsed = verifyProofSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const { action, remarks, paidAmount } = parsed.data

  const invoice = await prisma.feeInvoice.findUnique({
    where: { id: invoiceId },
    select: { 
      id: true, 
      challanNumber: true,
      studentId: true, 
      status: true,
      proofStatus: true,
      totalAmount: true,
      paidAmount: true,
      proofRemarks: true,
      classSectionId: true,
      proofDeclaredAmount: true,
      student: { select: { userId: true, dueAmount: true } },
    },
  })

  if (!invoice) return errors.notFound('Fee invoice')
  if (invoice.proofStatus !== 'PENDING') return errors.conflict('Invoice does not have a pending proof')
  if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') return errors.conflict('Invoice is already paid or cancelled')

  const remaining = Number(invoice.totalAmount) - Number(invoice.paidAmount)

  if (action === 'APPROVE' && invoice.classSectionId) {
    const group = await prisma.classSection.findUnique({
      where: { id: invoice.classSectionId },
      select: { installmentsAllowed: true },
    })
    const intendedAmount = paidAmount ?? (invoice.proofDeclaredAmount ? Number(invoice.proofDeclaredAmount) : remaining)
    if (group && !group.installmentsAllowed && intendedAmount < remaining) {
      return errors.conflict('This group does not allow installments — approve for the full remaining balance')
    }
  }

  if (action === 'APPROVE') {
    // Amount: what staff typed, or what the parent declared, or the whole balance.
    const declaredAmount = invoice.proofDeclaredAmount ? Number(invoice.proofDeclaredAmount) : null
    const amountToPay = paidAmount ? Math.min(paidAmount, remaining) : declaredAmount ? Math.min(declaredAmount, remaining) : remaining
    const willBePaid = Number(invoice.paidAmount) + amountToPay >= Number(invoice.totalAmount)
    const r = await recordPayment({
      invoiceId,
      amount: amountToPay,
      method: PROOF_METHOD,
      source: 'PROOF',
      receivedBy: session.user.id,
      transactionId: 'MANUAL_PROOF',
      remarks: remarks ?? 'Approved from uploaded proof',
      invoiceUpdate: {
        proofStatus: 'APPROVED',
        proofDeclaredAmount: null,
        proofRemarks: remarks ? `Admin: ${remarks}` : invoice.proofRemarks,
        // Partly paid: clear the proof so the parent can upload one for the rest.
        ...(!willBePaid && { proofUrl: null, proofRemarks: null, proofUploadedAt: null }),
      },
      audit: { action: 'UPDATE', entityType: 'FeeInvoice', extra: { proofStatus: 'APPROVED', amountApproved: amountToPay } },
    })
    if ('code' in r) return paymentErrorResponse(r)
    try {
      await prisma.notification.create({
        data: {
          userId: invoice.student.userId,
          title: r.invoiceStatus === 'PAID' ? 'Fee Payment Approved — Fully Paid' : 'Fee Payment Approved — Partial',
          message: r.invoiceStatus === 'PAID'
            ? `Your payment proof for invoice #${invoice.challanNumber || invoiceId} has been verified. Your fee is now fully paid. Receipt ${r.receiptNumber}.`
            : `Your payment of EGP ${r.amount.toLocaleString()} for invoice #${invoice.challanNumber || invoiceId} has been verified. Remaining: EGP ${r.remaining.toLocaleString()}. Receipt ${r.receiptNumber}.`,
          type: 'FEE_UPDATE',
          relatedId: invoiceId,
        },
      })
    } catch (err) {
      console.error('[PROOF_APPROVE_NOTIFY]', err)
    }
    const updatedInvoice = await prisma.feeInvoice.findUnique({ where: { id: invoiceId } })
    return successResponse({ ...updatedInvoice, receiptNumber: r.receiptNumber, paymentId: r.payment.id }, { message: 'Payment proof approved successfully' })
  }

  // Reject
  const updatedInvoice = await prisma.$transaction(async (tx) => {
    const res = await tx.feeInvoice.update({
      where: { id: invoiceId },
      data: {
        proofStatus: 'REJECTED',
        proofRemarks: remarks ? `Admin Rejection: ${remarks}` : invoice.proofRemarks,
      },
    })
    await tx.auditLog.create({
      data: { userId: session.user.id, action: 'UPDATE', entityType: 'FeeInvoice', entityId: invoiceId, changes: { proofStatus: 'REJECTED' } },
    })
    await tx.notification.create({
      data: {
        userId: invoice.student.userId,
        title: 'Fee Payment Rejected',
        message: `Your payment proof for invoice #${invoice.challanNumber || invoiceId} was rejected. ${remarks ? `Reason: ${remarks}` : 'Please contact the accounts office.'}`,
        type: 'FEE_UPDATE',
        relatedId: invoiceId,
      },
    })
    return res
  })
  return successResponse(updatedInvoice, { message: 'Payment proof rejected successfully' })
}
