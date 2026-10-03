/**
 * THE one place that records a payment against an invoice. Server-only.
 *
 * WHY: the same logic used to be copied in 5 endpoints (staff payment x2,
 * accountant payment, proof approval x2) with small differences. Every
 * payment now goes through recordPayment():
 *  - checks: invoice exists, not cancelled / already paid, amount > 0 and not
 *    above the balance, the group's installment rule, the payment method
 *  - one transaction: FeePayment (with a receipt number TN-RCPT-YYYY-NNNNN),
 *    invoice paidAmount/status (guarded against two payments at the same
 *    moment), the student's fee summary, an audit-log row
 *  - afterwards: the group's "payment overdue" warning is refreshed
 * Future sources (online payment, wallet) call the same function.
 */

import type { InvoiceStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isUniqueConflictOn, nextInSequence } from '@/lib/ids/sequence'
import { InvoiceChangedError, refreshGroupAfterPayment, updateInvoiceIfUnchanged } from '@/lib/fees/guarded-payment'
import { isActivePaymentMethod } from '@/lib/fees/payment-settings'
import { errorResponse, errors } from '@/lib/api-response'
import { afterPaymentRecorded } from '@/lib/fees/receipt'

export type PaymentSource = 'STAFF' | 'PROOF' | 'ONLINE' | 'WALLET'

export interface RecordPaymentInput {
  invoiceId: string
  /** Omitted = the whole remaining balance. */
  amount?: number
  method: string
  source: PaymentSource
  receivedBy: string
  transactionId?: string | null
  remarks?: string | null
  paymentDate?: Date
  /** Extra invoice fields to set in the same update (e.g. proofStatus on approval). */
  invoiceUpdate?: Prisma.FeeInvoiceUpdateManyMutationInput
  /** Audit-log action/entity (proof approvals log as an invoice UPDATE, like before). */
  audit?: { action: 'CREATE' | 'UPDATE'; entityType: 'FeePayment' | 'FeeInvoice'; extra?: Record<string, unknown> }
  /** Skip the group's "no installments" rule (credit moved from another group, docs/design-student-transfer.md). */
  allowPartial?: boolean
  /** Extra writes in the SAME transaction (e.g. the wallet debit for a wallet payment). Throw to cancel. */
  onTx?: (tx: Prisma.TransactionClient, payment: { id: string; amount: number }) => Promise<void>
}

export type PaymentErrorCode =
  | 'NOT_FOUND' | 'CANCELLED' | 'ALREADY_PAID' | 'INVALID_AMOUNT' | 'OVERPAY' | 'INSTALLMENTS' | 'BAD_METHOD' | 'CHANGED' | 'REFUSED'

export type RecordPaymentResult =
  | {
      ok: true
      payment: Awaited<ReturnType<typeof prisma.feePayment.create>>
      receiptNumber: string
      invoiceStatus: InvoiceStatus
      amount: number
      remaining: number
      studentId: string
      classSectionId: string | null
    }
  | { ok: false; code: PaymentErrorCode; message: string }

const round2 = (n: number) => Math.round(n * 100) / 100

/** Throw from onTx to cancel the payment with a clear message (e.g. not enough in the wallet). */
export class PaymentRefusedError extends Error {}

/** Next receipt number TN-RCPT-YYYY-NNNNN (highest + 1; callers retry on a clash). */
export async function nextReceiptNumber(db: Prisma.TransactionClient | typeof prisma = prisma) {
  const prefix = `TN-RCPT-${new Date().getFullYear()}-`
  const rows = await db.feePayment.findMany({ where: { receiptNumber: { startsWith: prefix } }, select: { receiptNumber: true } })
  return nextInSequence(rows.map((r) => r.receiptNumber!).filter(Boolean), prefix, 5)
}

/** Methods the system records by itself (not picked from the list by staff). */
const SYSTEM_SOURCES: PaymentSource[] = ['PROOF', 'ONLINE', 'WALLET']

export async function recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  const invoice = await prisma.feeInvoice.findUnique({
    where: { id: input.invoiceId },
    select: {
      id: true, studentId: true, totalAmount: true, paidAmount: true, status: true, classSectionId: true,
      student: { select: { dueAmount: true } },
    },
  })
  if (!invoice) return { ok: false, code: 'NOT_FOUND', message: 'Invoice not found' }
  if (invoice.status === 'CANCELLED') return { ok: false, code: 'CANCELLED', message: 'Cannot record a payment on a cancelled invoice' }
  if (invoice.status === 'PAID') return { ok: false, code: 'ALREADY_PAID', message: 'This invoice is already fully paid' }

  const total = Number(invoice.totalAmount)
  const paid = Number(invoice.paidAmount)
  const remaining = round2(total - paid)
  const amount = round2(input.amount ?? remaining)
  if (!(amount > 0)) return { ok: false, code: 'INVALID_AMOUNT', message: 'The amount must be more than zero' }
  if (amount > remaining + 0.001) {
    return { ok: false, code: 'OVERPAY', message: `The amount (${amount}) is more than the remaining balance (${remaining})` }
  }

  if (invoice.classSectionId && amount < remaining && !input.allowPartial) {
    const group = await prisma.classSection.findUnique({ where: { id: invoice.classSectionId }, select: { installmentsAllowed: true } })
    if (group && !group.installmentsAllowed) {
      return { ok: false, code: 'INSTALLMENTS', message: 'This group does not allow installments — the full remaining balance must be paid at once' }
    }
  }

  if (!SYSTEM_SOURCES.includes(input.source) && !(await isActivePaymentMethod(input.method))) {
    return { ok: false, code: 'BAD_METHOD', message: 'Unknown payment method. Choose one from the list.' }
  }

  const newPaid = round2(paid + amount)
  const invoiceStatus: InvoiceStatus = newPaid >= total ? 'PAID' : 'PARTIALLY_PAID'

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Receipt number: retry if two payments take the same number at once.
      let payment: Awaited<ReturnType<typeof tx.feePayment.create>> | null = null
      for (let attempt = 0; !payment; attempt++) {
        const receiptNumber = await nextReceiptNumber(tx)
        try {
          payment = await tx.feePayment.create({
            data: {
              invoiceId: invoice.id,
              studentId: invoice.studentId,
              amount,
              paymentMethod: input.method,
              transactionId: input.transactionId ?? null,
              paymentDate: input.paymentDate ?? new Date(),
              status: 'COMPLETED',
              receivedBy: input.receivedBy,
              remarks: input.remarks ?? null,
              receiptNumber,
              source: input.source,
            },
          })
        } catch (err) {
          if (attempt < 4 && isUniqueConflictOn(err, 'receiptNumber')) continue
          throw err
        }
      }

      await updateInvoiceIfUnchanged(tx, invoice.id, invoice.paidAmount, {
        paidAmount: newPaid,
        status: invoiceStatus,
        ...input.invoiceUpdate,
      })

      // Student fee summary (denormalised), never below zero.
      const remainingStudentDue = Math.max(0, Number(invoice.student.dueAmount) - amount)
      await tx.student.update({
        where: { id: invoice.studentId },
        data: {
          paidAmount: { increment: amount },
          dueAmount: remainingStudentDue,
          feeStatus: invoiceStatus === 'PAID' && remainingStudentDue <= 0 ? 'PAID' : 'PARTIALLY_PAID',
        },
      })

      const audit = input.audit ?? { action: 'CREATE' as const, entityType: 'FeePayment' as const }
      await tx.auditLog.create({
        data: {
          userId: input.receivedBy,
          action: audit.action,
          entityType: audit.entityType,
          entityId: audit.entityType === 'FeePayment' ? payment.id : invoice.id,
          changes: {
            invoiceId: invoice.id, paymentId: payment.id, receiptNumber: payment.receiptNumber, amount,
            paymentMethod: input.method, source: input.source, newStatus: invoiceStatus, ...audit.extra,
          } as Prisma.InputJsonValue,
        },
      })
      if (input.onTx) await input.onTx(tx, { id: payment.id, amount })
      return payment
    })
    await refreshGroupAfterPayment(invoice.classSectionId, input.receivedBy)
    await afterPaymentRecorded(result.id) // automatic WhatsApp receipt, if switched on
    return {
      ok: true,
      payment: result,
      receiptNumber: result.receiptNumber!,
      invoiceStatus,
      amount,
      remaining: round2(total - newPaid),
      studentId: invoice.studentId,
      classSectionId: invoice.classSectionId,
    }
  } catch (err) {
    if (err instanceof InvoiceChangedError) return { ok: false, code: 'CHANGED', message: err.message }
    if (err instanceof PaymentRefusedError) return { ok: false, code: 'REFUSED', message: err.message }
    throw err
  }
}

/** HTTP response for a failed recordPayment (same status codes the endpoints used before). */
export function paymentErrorResponse(r: { code: PaymentErrorCode; message: string }) {
  switch (r.code) {
    case 'NOT_FOUND': return errors.notFound('Invoice')
    case 'INVALID_AMOUNT':
    case 'OVERPAY': return errors.validation({ errors: [{ path: ['amount'], message: r.message }] } as never)
    case 'BAD_METHOD': return errors.badRequest(r.message)
    case 'CANCELLED':
    case 'ALREADY_PAID':
    case 'INSTALLMENTS':
    case 'CHANGED':
    case 'REFUSED': return errors.conflict(r.message)
    default: return errorResponse('PAYMENT_FAILED', r.message, 400)
  }
}
