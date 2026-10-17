/**
 * Safe document numbers (2026-10-17): receipts, invoices, top-ups, withdrawals, refunds.
 *
 * WHY: "highest number + 1, retry on a clash" breaks when two payments are saved at the same moment. MySQL keeps
 * showing a transaction the same snapshot, so every retry picked the same number again and the payment failed
 * (seen in the e2e log as a FeePayment_receiptNumber_key error).
 * NOW: one row per prefix in DocumentCounter is locked (SELECT … FOR UPDATE) while a number is issued; the lock lasts
 * until the payment's transaction ends, so simultaneous payments wait a moment and get the next number.
 * The first time a prefix is used (e.g. a new year) the counter starts from the highest number already in the table.
 * Called outside a transaction it uses its own short one (the number is then reserved even if creation fails).
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type Db = Prisma.TransactionClient | typeof prisma

export interface NumberSpec {
  /** e.g. "TN-RCPT-2026-" */
  prefix: string
  pad: number
  /** table + column that store the number (trusted constants, never user input) */
  table: 'FeePayment' | 'FeeInvoice' | 'WalletTopUp' | 'WalletWithdrawal' | 'Refund' | 'MoneyTransfer'
  column: 'receiptNumber' | 'challanNumber' | 'topUpNumber' | 'withdrawalNumber' | 'refundNumber' | 'number'
}

export const formatNumber = (prefix: string, n: number, pad: number) => `${prefix}${String(n).padStart(pad, '0')}`

/** Highest number already stored with this prefix (a locking read, so it sees rows other payments just saved). */
async function highestStored(db: Db, spec: NumberSpec): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ m: bigint | number | null }[]>(
    `SELECT MAX(CAST(SUBSTRING(\`${spec.column}\`, ${spec.prefix.length + 1}) AS UNSIGNED)) AS m FROM \`${spec.table}\` WHERE \`${spec.column}\` LIKE ? FOR SHARE`,
    `${spec.prefix}%`,
  )
  return Number(rows[0]?.m ?? 0)
}

/**
 * Make the counter row the first time a prefix is used, starting from the highest stored number. Runs on its own
 * connection (autocommit), NOT in the payment's transaction: an INSERT IGNORE inside the transaction takes a shared
 * lock, and two payments upgrading that shared lock to FOR UPDATE at the same moment deadlock (seen in the e2e).
 */
async function ensureCounter(tx: Db, spec: NumberSpec) {
  const exists = await tx.$queryRawUnsafe<unknown[]>('SELECT 1 FROM `DocumentCounter` WHERE `key` = ?', spec.prefix) // plain read, no lock
  if (exists.length) return
  await prisma.$executeRawUnsafe(
    `INSERT IGNORE INTO \`DocumentCounter\` (\`key\`, \`value\`, \`updatedAt\`) SELECT ?, COALESCE(MAX(CAST(SUBSTRING(\`${spec.column}\`, ${spec.prefix.length + 1}) AS UNSIGNED)), 0), NOW(3) FROM \`${spec.table}\` WHERE \`${spec.column}\` LIKE ?`,
    spec.prefix, `${spec.prefix}%`,
  )
}

async function take(tx: Db, spec: NumberSpec, resync: boolean): Promise<string> {
  await ensureCounter(tx, spec)
  // only an exclusive lock here: simultaneous payments queue for it one after the other (no deadlock)
  const rows = await tx.$queryRawUnsafe<{ value: number }[]>('SELECT `value` FROM `DocumentCounter` WHERE `key` = ? FOR UPDATE', spec.prefix)
  let last = Number(rows[0]?.value ?? 0)
  // first use of this prefix, or a clash told us the counter is behind the stored numbers
  if (last === 0 || resync) last = Math.max(last, await highestStored(tx, spec))
  const next = last + 1
  await tx.$executeRawUnsafe('UPDATE `DocumentCounter` SET `value` = ?, `updatedAt` = NOW(3) WHERE `key` = ?', next, spec.prefix)
  return formatNumber(spec.prefix, next, spec.pad)
}

/**
 * The next number for this prefix. Pass the caller's transaction so the lock lasts until the document is saved.
 * `resync: true` (on a retry after a clash) also looks at the highest stored number.
 */
export async function takeNumber(db: Db, spec: NumberSpec, opts: { resync?: boolean } = {}): Promise<string> {
  const isRoot = typeof (db as typeof prisma).$transaction === 'function'
  if (isRoot) return (db as typeof prisma).$transaction((tx) => take(tx, spec, !!opts.resync))
  return take(db, spec, !!opts.resync)
}
