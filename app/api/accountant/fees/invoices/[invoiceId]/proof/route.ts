/**
 * PATCH /api/accountant/fees/invoices/[invoiceId]/proof
 * Accountant action on a guardian-uploaded payment proof (APPROVE or REJECT).
 */

import { canSeeInvoice } from '@/lib/places/server'
import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { paymentErrorResponse, recordPayment } from '@/lib/fees/record-payment'
import { PROOF_METHOD } from '@/lib/fees/payment-settings'
import { errors, successResponse } from '@/lib/api-response'
import { proofActionSchema } from '@/lib/validation/accountant-fee'
import { dispatchNotification } from '@/lib/notifications/in-app'
import { withMonthLock } from '@/lib/month-close/with-lock'

async function PATCH_(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role, 'fee_collection', 'update')) {
    return errors.forbidden()
  }

  const { invoiceId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON body' }] } as never)
  }

  const parsed = proofActionSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const { action, remarks, paidAmount } = parsed.data

  const existing = await prisma.feeInvoice.findUnique({
    where: { id: invoiceId },
    select: { 
      id: true, 
      studentId: true, 
      challanNumber: true,
      status: true, 
      proofStatus: true,
      totalAmount: true,
      paidAmount: true,
      classSectionId: true,
      proofDeclaredAmount: true,
      student: { select: { campusId: true, dueAmount: true, userId: true } } 
    },
  })

  if (!existing) return errors.notFound('Invoice not found')
  if (existing.proofStatus !== 'PENDING') return errors.conflict('There is no pending proof to action')
  if (existing.status === 'PAID') return errors.conflict('Invoice is already fully paid')
  if (existing.status === 'CANCELLED') return errors.conflict('Cannot approve proof for a cancelled invoice')

  // M0: proofs on invoices of the person's places only
  if (!(await canSeeInvoice(session.user, invoiceId))) {
    return errors.forbidden('Cannot action proof for an invoice outside your places')
  }

  if (action === 'APPROVE' && existing.classSectionId) {
    const group = await prisma.classSection.findUnique({
      where: { id: existing.classSectionId },
      select: { installmentsAllowed: true },
    })
    const remaining = Number(existing.totalAmount) - Number(existing.paidAmount)
    const intendedAmount = paidAmount ?? (existing.proofDeclaredAmount ? Number(existing.proofDeclaredAmount) : remaining)
    if (group && !group.installmentsAllowed && intendedAmount < remaining) {
      return errors.conflict('This group does not allow installments — approve for the full remaining balance')
    }
  }

  if (action === 'APPROVE') {
    const remaining = Number(existing.totalAmount) - Number(existing.paidAmount)
    // Amount: what the accountant typed, or what the parent declared, or the whole balance.
    const declaredAmount = existing.proofDeclaredAmount ? Number(existing.proofDeclaredAmount) : null
    const amountToPay = paidAmount ? Math.min(paidAmount, remaining) : declaredAmount ? Math.min(declaredAmount, remaining) : remaining
    const willBePaid = Number(existing.paidAmount) + amountToPay >= Number(existing.totalAmount)
    const r = await recordPayment({
      invoiceId,
      amount: amountToPay,
      method: PROOF_METHOD,
      source: 'PROOF',
      receivedBy: session.user.id,
      remarks: remarks ?? 'Approved from proof',
      invoiceUpdate: {
        proofStatus: 'APPROVED',
        proofDeclaredAmount: null,
        // Partly paid: clear the proof so the parent can upload one for the rest.
        ...(!willBePaid && { proofUrl: null, proofRemarks: null, proofUploadedAt: null }),
      },
      audit: { action: 'UPDATE', entityType: 'FeeInvoice', extra: { proofStatus: 'APPROVED', amountApproved: amountToPay } },
    })
    if ('code' in r) return paymentErrorResponse(r)
    try {
      await prisma.notification.create({
        data: {
          userId: existing.student.userId,
          title: r.invoiceStatus === 'PAID' ? 'Fee Payment Approved — Fully Paid' : 'Fee Payment Approved — Partial',
          message: r.invoiceStatus === 'PAID'
            ? `Your payment proof for invoice #${existing.challanNumber} has been verified. Your fee is now fully paid. Receipt ${r.receiptNumber}.`
            : `Your payment of EGP ${r.amount.toLocaleString()} for invoice #${existing.challanNumber} has been verified. Remaining balance: EGP ${r.remaining.toLocaleString()}. Receipt ${r.receiptNumber}.`,
          titleAr: r.invoiceStatus === 'PAID' ? 'الدفع اتقبل — الفاتورة اتدفعت كلها' : 'الدفع اتقبل — جزء',
          messageAr: r.invoiceStatus === 'PAID'
            ? `إيصال الدفع لفاتورة #${existing.challanNumber} اتراجع، والفاتورة اتدفعت كلها. إيصال ${r.receiptNumber}.`
            : `اتقبل دفع ${r.amount.toLocaleString()} ج.م لفاتورة #${existing.challanNumber}. الباقي ${r.remaining.toLocaleString()} ج.م. إيصال ${r.receiptNumber}.`,
          type: 'FEE_UPDATE',
          relatedId: invoiceId,
        },
      })
    } catch (err) {
      console.error('[PROOF_APPROVE_NOTIFY]', err)
    }
    dispatchNotification({ type: 'PROOF_APPROVED', invoiceId, studentId: existing.studentId })
    return successResponse({ receiptNumber: r.receiptNumber, paymentId: r.payment.id, invoiceStatus: r.invoiceStatus }, 'Payment proof approved successfully')
  }

  // REJECT
  await prisma.$transaction(async (tx) => {
    await tx.feeInvoice.update({
      where: { id: invoiceId },
      data: { proofStatus: 'REJECTED', proofRemarks: remarks ? `Rejected: ${remarks}` : 'Rejected' },
    })
    await tx.notification.create({
      data: {
        userId: existing.student.userId,
        title: 'Payment Proof Rejected',
        message: `Your payment proof for invoice #${existing.challanNumber} was rejected.${remarks ? ` Reason: ${remarks}` : ' Please contact the accounts office.'}`,
        titleAr: 'إيصال الدفع اترفض',
        messageAr: `إيصال الدفع لفاتورة #${existing.challanNumber} اترفض.${remarks ? ` السبب: ${remarks}` : ' كلّم الحسابات.'}`,
        type: 'FEE_UPDATE',
        relatedId: invoiceId,
      },
    })
    await tx.auditLog.create({
      data: { userId: session.user.id, action: 'UPDATE', entityType: 'FeeInvoice', entityId: invoiceId, changes: { proofStatus: 'REJECTED', remarks } },
    })
  })
  dispatchNotification({ type: 'PROOF_REJECTED', invoiceId, studentId: existing.studentId, reason: remarks ?? 'Invalid or unreadable proof' })
  return successResponse(null, 'Payment proof rejected successfully')
}

// a03: a write into a closed month answers 409 with the reason
export const PATCH = withMonthLock(PATCH_)
