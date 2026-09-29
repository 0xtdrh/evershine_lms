/**
 * Safe invoice updates when recording a payment.
 *
 * WHY: every payment endpoint reads the invoice, checks the remaining balance,
 * then writes. Two payments recorded at the same moment could both pass the
 * check (over-payment) or overwrite each other (a lost payment). The update is
 * now conditional on paidAmount still being the value that was checked; if
 * someone else changed the invoice in between, the whole transaction is rolled
 * back and the user is asked to try again.
 */

import type { Prisma } from '@prisma/client'
import { syncGroupProgress } from '@/lib/groups/sync-progress'

export class InvoiceChangedError extends Error {
  constructor() {
    super('This invoice was just updated by someone else. Refresh the page and try again.')
    this.name = 'InvoiceChangedError'
  }
}

export async function updateInvoiceIfUnchanged(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  paidAmountWhenChecked: Prisma.Decimal | number,
  data: Prisma.FeeInvoiceUpdateManyMutationInput
) {
  const result = await tx.feeInvoice.updateMany({
    where: { id: invoiceId, paidAmount: paidAmountWhenChecked },
    data,
  })
  if (result.count !== 1) throw new InvoiceChangedError()
}

/**
 * After a payment, re-run the group check so a "payment overdue" warning is
 * cleared right away (it used to stay until the group was opened). Never
 * allowed to break the payment.
 */
export async function refreshGroupAfterPayment(classSectionId: string | null | undefined, userId: string) {
  if (!classSectionId) return
  try {
    await syncGroupProgress(classSectionId, userId)
  } catch (err) {
    console.error('[PAYMENT_SYNC_PROGRESS]', err)
  }
}

/** Runs a payment transaction; returns the InvoiceChangedError instead of throwing it. */
export async function catchInvoiceChanged<T>(fn: () => Promise<T>): Promise<T | InvoiceChangedError> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof InvoiceChangedError) return err
    throw err
  }
}
