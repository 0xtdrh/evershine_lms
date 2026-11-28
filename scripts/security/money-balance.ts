/**
 * MONEY CHECK (owner 28/11: "make sure nothing goes wrong in any money operation"). Read-only "balance" of the books:
 * every rule below must hold in ANY database (local copy, e2e copy, later the live one). A row printed = a real problem.
 *
 *   DATABASE_URL=mysql://root@127.0.0.1:3410/technova npx tsx scripts/security/money-balance.ts
 *
 * Nothing is changed. Amounts compared to the piastre (0.01).
 */

import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()
type Row = Record<string, unknown>
const results: { rule: string; bad: number; sample: Row[] }[] = []

async function rule(name: string, sql: string) {
  try {
    const rows = await p.$queryRawUnsafe<Row[]>(sql)
    results.push({ rule: name, bad: rows.length, sample: rows.slice(0, 5) })
  } catch (e) {
    results.push({ rule: `${name} (QUERY FAILED: ${(e as Error).message.split('\n')[0]})`, bad: -1, sample: [] })
  }
}

async function main() {
  // 1. what an invoice says was paid = the completed (not cancelled) payments on it
  await rule('invoice paidAmount = sum of its COMPLETED payments', `
    SELECT i.challanNumber, i.paidAmount, COALESCE(SUM(CASE WHEN p.status='COMPLETED' THEN p.amount END),0) AS payments
    FROM FeeInvoice i LEFT JOIN FeePayment p ON p.invoiceId=i.id
    GROUP BY i.id HAVING ABS(i.paidAmount - payments) >= 0.01`)

  // 2. invoice status agrees with its numbers
  await rule('PAID invoice is really paid / an unpaid one is not marked PAID', `
    SELECT challanNumber, status, totalAmount, paidAmount FROM FeeInvoice
    WHERE (status='PAID' AND paidAmount + 0.01 < totalAmount AND totalAmount > 0)
       OR (status IN ('ISSUED','OVERDUE','PARTIALLY_PAID') AND paidAmount >= totalAmount AND totalAmount > 0)`)

  await rule('nothing paid above the invoice total (net of refunds)', `
    SELECT challanNumber, totalAmount, paidAmount, refundedAmount FROM FeeInvoice WHERE paidAmount - totalAmount >= 0.01`)

  // 3. a family is never asked for more than the invoice lines (subtotal − discount + late fee + penalty). The total may
  //    legitimately be LOWER: a transfer to another group cuts the unused part, a seat let go cuts it to what was used.
  await rule('invoice total never above subtotal − discount + late fee + penalty', `
    SELECT challanNumber, subtotal, discount, lateFee, penaltyAmount, totalAmount FROM FeeInvoice
    WHERE totalAmount - (subtotal - discount + lateFee + penaltyAmount) >= 0.01`)
  await rule('invoice total and discount are never negative', `
    SELECT challanNumber, totalAmount, discount FROM FeeInvoice WHERE totalAmount < 0 OR discount < 0 OR paidAmount < 0 OR refundedAmount < 0`)

  // 4. the discount on the invoice = its discount lines
  await rule('invoice discount = sum of its discount lines (when it has lines)', `
    SELECT i.challanNumber, i.discount, x.total_lines FROM FeeInvoice i
    JOIN (SELECT invoiceId, SUM(amount) AS total_lines FROM InvoiceDiscount GROUP BY invoiceId) x ON x.invoiceId=i.id
    WHERE ABS(i.discount - x.total_lines) >= 0.01`)

  // 5. refunded on the invoice = approved refunds
  await rule('invoice refundedAmount = its APPROVED refunds', `
    SELECT i.challanNumber, i.refundedAmount, COALESCE(SUM(CASE WHEN r.status='APPROVED' THEN r.amount END),0) AS refunds
    FROM FeeInvoice i LEFT JOIN Refund r ON r.invoiceId=i.id GROUP BY i.id HAVING ABS(i.refundedAmount - refunds) >= 0.01`)

  await rule('never refunded more than was paid', `
    SELECT challanNumber, paidAmount, refundedAmount FROM FeeInvoice WHERE refundedAmount - paidAmount >= 0.01`)

  // 6. a payment's student = its invoice's student
  await rule('payment student = invoice student', `
    SELECT p.receiptNumber, p.studentId, i.studentId AS invoiceStudent FROM FeePayment p JOIN FeeInvoice i ON i.id=p.invoiceId WHERE p.studentId <> i.studentId`)

  // 7. receipts, invoices, top-ups, refunds: numbers never repeat
  await rule('receipt numbers are unique', `SELECT receiptNumber, COUNT(*) n FROM FeePayment WHERE receiptNumber IS NOT NULL GROUP BY receiptNumber HAVING n > 1`)
  await rule('invoice numbers are unique', `SELECT challanNumber, COUNT(*) n FROM FeeInvoice GROUP BY challanNumber HAVING n > 1`)
  await rule('top-up numbers are unique', `SELECT topUpNumber, COUNT(*) n FROM WalletTopUp WHERE topUpNumber IS NOT NULL GROUP BY topUpNumber HAVING n > 1`)
  await rule('refund numbers are unique', `SELECT refundNumber, COUNT(*) n FROM Refund WHERE refundNumber IS NOT NULL GROUP BY refundNumber HAVING n > 1`)

  // 8. wallet-first: every completed staff / proof / online payment passed through the wallet (top-up + payment pair)
  await rule('each completed STAFF/PROOF/ONLINE payment has its wallet top-up (source PAYMENT)', `
    SELECT p.receiptNumber, p.source, p.amount FROM FeePayment p
    WHERE p.status='COMPLETED' AND p.source IN ('STAFF','PROOF','ONLINE')
      AND NOT EXISTS (SELECT 1 FROM WalletTopUp t WHERE t.paymentId=p.id AND t.source='PAYMENT' AND t.status='APPROVED')`)

  // 9. a cancelled payment leaves no money behind in the wallet / box
  await rule('a VOIDED payment has no APPROVED top-up left', `
    SELECT p.receiptNumber FROM FeePayment p JOIN WalletTopUp t ON t.paymentId=p.id AND t.source='PAYMENT'
    WHERE p.status='VOIDED' AND t.status='APPROVED'`)

  // 10. wallets never go below zero
  await rule('no wallet below zero', `
    SELECT studentId, SUM(amount) AS balance FROM WalletTransaction GROUP BY studentId HAVING balance <= -0.01`)

  // 11. the cash box sees each real payment once, with the same amount
  await rule('each cash-box movement of a payment has the payment amount (IN)', `
    SELECT p.receiptNumber, p.amount, m.amount AS moved, m.direction FROM MoneyMovement m JOIN FeePayment p ON p.id=m.feePaymentId
    WHERE ABS(m.amount - p.amount) >= 0.01 OR m.direction <> 'IN'`)
  await rule('no cash-box movement left for a VOIDED payment', `
    SELECT p.receiptNumber FROM MoneyMovement m JOIN FeePayment p ON p.id=m.feePaymentId WHERE p.status <> 'COMPLETED'`)
  await rule('a payment is in the cash box at most once', `SELECT feePaymentId, COUNT(*) n FROM MoneyMovement WHERE feePaymentId IS NOT NULL GROUP BY feePaymentId HAVING n > 1`)

  // 12. paid by the wallet: the wallet was debited the same amount
  await rule('each WALLET payment has its wallet debit of the same amount', `
    SELECT p.receiptNumber, p.amount FROM FeePayment p
    WHERE p.status='COMPLETED' AND p.source='WALLET'
      AND NOT EXISTS (SELECT 1 FROM WalletTransaction w WHERE w.paymentId=p.id AND ABS(w.amount + p.amount) < 0.01)`)

  // 13. no money on a cancelled invoice
  await rule('a CANCELLED invoice has no completed payment (unless refunded in full)', `
    SELECT i.challanNumber, i.paidAmount, i.refundedAmount FROM FeeInvoice i
    WHERE i.status='CANCELLED' AND i.paidAmount - i.refundedAmount >= 0.01`)

  // 14. a confirmed booking really has a paid invoice
  await rule('a CONFIRMED booking points to an invoice that is paid (or free)', `
    SELECT b.id, i.challanNumber, i.totalAmount, i.paidAmount FROM CourseBooking b JOIN FeeInvoice i ON i.id=b.invoiceId
    WHERE b.status='CONFIRMED' AND i.totalAmount > 0 AND i.paidAmount <= 0`)

  // 15. enrolment code uses = recorded uses
  await rule('code "uses" = the uses recorded', `
    SELECT c.code, c.uses, COUNT(u.id) AS recorded FROM EnrolmentCode c LEFT JOIN EnrolmentCodeUse u ON u.codeId=c.id GROUP BY c.id HAVING c.uses <> recorded`)

  let problems = 0
  for (const r of results) {
    const mark = r.bad === 0 ? 'OK  ' : r.bad < 0 ? 'ERR ' : 'BAD '
    if (r.bad !== 0) problems++
    console.log(`${mark} ${r.rule}${r.bad > 0 ? ` — ${r.bad} row(s)` : ''}`)
    for (const s of r.sample) console.log('       ', JSON.stringify(s, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)))
  }
  console.log(`\n${results.length} rules, ${problems} with problems`)
  await p.$disconnect()
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1) })
