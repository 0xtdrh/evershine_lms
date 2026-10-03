/**
 * Wallet document numbers (phase B): TN-TOPUP-YYYY-NNNNN and TN-WDRW-YYYY-NNNNN.
 * Kept apart from the wallet engine so record-payment can use it without an import cycle.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isUniqueConflictOn, nextInSequence } from '@/lib/ids/sequence'

type Db = Prisma.TransactionClient | typeof prisma

export async function nextTopUpNumber(db: Db = prisma) {
  const prefix = `TN-TOPUP-${new Date().getFullYear()}-`
  const rows = await db.walletTopUp.findMany({ where: { topUpNumber: { startsWith: prefix } }, select: { topUpNumber: true } })
  return nextInSequence(rows.map((r) => r.topUpNumber!).filter(Boolean), prefix, 5)
}

export async function nextWithdrawalNumber(db: Db = prisma) {
  const prefix = `TN-WDRW-${new Date().getFullYear()}-`
  const rows = await db.walletWithdrawal.findMany({ where: { withdrawalNumber: { startsWith: prefix } }, select: { withdrawalNumber: true } })
  return nextInSequence(rows.map((r) => r.withdrawalNumber!).filter(Boolean), prefix, 5)
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
    const topUpNumber = await nextTopUpNumber(tx)
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
