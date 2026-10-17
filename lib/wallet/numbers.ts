/**
 * Wallet document numbers (phase B): TN-TOPUP-YYYY-NNNNN and TN-WDRW-YYYY-NNNNN.
 * Kept apart from the wallet engine so record-payment can use it without an import cycle.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isUniqueConflictOn } from '@/lib/ids/sequence'
import { takeNumber } from '@/lib/ids/counter'

type Db = Prisma.TransactionClient | typeof prisma

/** TN-TOPUP-YYYY-NNNNN from the locked counter (lib/ids/counter.ts). */
export async function nextTopUpNumber(db: Db = prisma, opts: { resync?: boolean } = {}) {
  return takeNumber(db, { prefix: `TN-TOPUP-${new Date().getFullYear()}-`, pad: 5, table: 'WalletTopUp', column: 'topUpNumber' }, opts)
}

/** TN-WDRW-YYYY-NNNNN from the locked counter (lib/ids/counter.ts). */
export async function nextWithdrawalNumber(db: Db = prisma, opts: { resync?: boolean } = {}) {
  return takeNumber(db, { prefix: `TN-WDRW-${new Date().getFullYear()}-`, pad: 5, table: 'WalletWithdrawal', column: 'withdrawalNumber' }, opts)
}

/** Creates an APPROVED top-up with its number (retries on a number clash) and credits the wallet. */
export async function createApprovedTopUp(
  tx: Prisma.TransactionClient,
  data: {
    studentId: string
    amount: number
    method: string
    source: 'STAFF' | 'PROOF' | 'ONLINE' | 'PAYMENT'
    fee?: number
    transactionId?: string | null
    proofUrl?: string | null
    remarks?: string | null
    invoiceId?: string | null
    paymentId?: string | null
    userId?: string | null
  }
) {
  let row: { id: string; topUpNumber: string | null } | null = null
  for (let attempt = 0; !row; attempt++) {
    const topUpNumber = await nextTopUpNumber(tx, { resync: attempt > 0 })
    try {
      row = await tx.walletTopUp.create({
        data: {
          topUpNumber,
          studentId: data.studentId,
          amount: data.amount,
          fee: data.fee ?? 0,
          method: data.method,
          source: data.source,
          status: 'APPROVED',
          transactionId: data.transactionId ?? null,
          proofUrl: data.proofUrl ?? null,
          remarks: data.remarks ?? null,
          invoiceId: data.invoiceId ?? null,
          paymentId: data.paymentId ?? null,
          createdById: data.userId ?? null,
          approvedById: data.userId ?? null,
          approvedAt: new Date(),
        },
        select: { id: true, topUpNumber: true },
      })
    } catch (err) {
      if (attempt < 4 && isUniqueConflictOn(err, 'topUpNumber')) continue
      throw err
    }
  }
  await tx.walletTransaction.create({
    data: { studentId: data.studentId, amount: data.amount, type: 'TOPUP', topUpId: row.id, note: `Top-up ${row.topUpNumber}`, createdById: data.userId ?? 'system' },
  })
  return row
}
