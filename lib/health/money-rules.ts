/**
 * MONEY RULES (owner 28/11: "make sure nothing goes wrong in any money operation"). Each rule is a read-only SQL that
 * returns the rows that BREAK it — an empty answer means the rule holds. Used by:
 *   - scripts/security/money-balance.ts (any database; the e2e runs it at the end),
 *   - Data Health → «الفلوس» (S2), so the office sees it without asking anyone.
 * Amounts compared to the piastre (0.01). RELATIVE imports only (tsx scripts load this file).
 */

import type { PrismaClient } from '@prisma/client'

export interface MoneyRule { key: string; en: string; ar: string; sql: string }

export const MONEY_RULES: MoneyRule[] = [
  { key: "invoice_paidamount_sum_of_its_completed_", en: "invoice paidAmount = sum of its COMPLETED payments", ar: "المدفوع في الفاتورة = الإيصالات المكتملة",
    sql: "SELECT i.challanNumber, i.paidAmount, COALESCE(SUM(CASE WHEN p.status='COMPLETED' THEN p.amount END),0) AS payments FROM FeeInvoice i LEFT JOIN FeePayment p ON p.invoiceId=i.id GROUP BY i.id HAVING ABS(i.paidAmount - payments) >= 0.01" },
  { key: "paid_invoice_is_really_paid_an_unpaid_on", en: "PAID invoice is really paid / an unpaid one is not marked PAID", ar: "الفاتورة «مدفوعة» مدفوعة فعلًا، والمش مدفوعة مش مكتوب عليها مدفوعة",
    sql: "SELECT challanNumber, status, totalAmount, paidAmount FROM FeeInvoice WHERE (status='PAID' AND paidAmount + 0.01 < totalAmount AND totalAmount > 0) OR (status IN ('ISSUED','OVERDUE','PARTIALLY_PAID') AND paidAmount >= totalAmount AND totalAmount > 0)" },
  { key: "nothing_paid_above_the_invoice_total_net", en: "nothing paid above the invoice total (net of refunds)", ar: "مفيش دفع أكتر من إجمالي الفاتورة",
    sql: "SELECT challanNumber, totalAmount, paidAmount, refundedAmount FROM FeeInvoice WHERE paidAmount - totalAmount >= 0.01" },
  { key: "invoice_total_never_above_subtotal_disco", en: "invoice total never above subtotal − discount + late fee + penalty", ar: "إجمالي الفاتورة عمره ما يزيد عن سطورها",
    sql: "SELECT challanNumber, subtotal, discount, lateFee, penaltyAmount, totalAmount FROM FeeInvoice WHERE totalAmount - (subtotal - discount + lateFee + penaltyAmount) >= 0.01" },
  { key: "invoice_total_and_discount_are_never_neg", en: "invoice total and discount are never negative", ar: "مفيش مبالغ بالسالب في الفواتير",
    sql: "SELECT challanNumber, totalAmount, discount FROM FeeInvoice WHERE totalAmount < 0 OR discount < 0 OR paidAmount < 0 OR refundedAmount < 0" },
  { key: "invoice_discount_sum_of_its_discount_lin", en: "invoice discount = sum of its discount lines (when it has lines)", ar: "الخصم في الفاتورة = سطور الخصم",
    sql: "SELECT i.challanNumber, i.discount, x.total_lines FROM FeeInvoice i JOIN (SELECT invoiceId, SUM(amount) AS total_lines FROM InvoiceDiscount GROUP BY invoiceId) x ON x.invoiceId=i.id WHERE ABS(i.discount - x.total_lines) >= 0.01" },
  { key: "invoice_refundedamount_its_approved_refu", en: "invoice refundedAmount = its APPROVED refunds", ar: "المسترد في الفاتورة = الاستردادات المعتمدة",
    sql: "SELECT i.challanNumber, i.refundedAmount, COALESCE(SUM(CASE WHEN r.status='APPROVED' THEN r.amount END),0) AS refunds FROM FeeInvoice i LEFT JOIN Refund r ON r.invoiceId=i.id GROUP BY i.id HAVING ABS(i.refundedAmount - refunds) >= 0.01" },
  { key: "never_refunded_more_than_was_paid", en: "never refunded more than was paid", ar: "عمر ما اترد أكتر من المدفوع",
    sql: "SELECT challanNumber, paidAmount, refundedAmount FROM FeeInvoice WHERE refundedAmount - paidAmount >= 0.01" },
  { key: "payment_student_invoice_student", en: "payment student = invoice student", ar: "طالب الإيصال = طالب الفاتورة",
    sql: "SELECT p.receiptNumber, p.studentId, i.studentId AS invoiceStudent FROM FeePayment p JOIN FeeInvoice i ON i.id=p.invoiceId WHERE p.studentId <> i.studentId" },
  { key: "receipt_numbers_are_unique", en: "receipt numbers are unique", ar: "أرقام الإيصالات مش متكررة",
    sql: "SELECT receiptNumber, COUNT(*) n FROM FeePayment WHERE receiptNumber IS NOT NULL GROUP BY receiptNumber HAVING n > 1" },
  { key: "invoice_numbers_are_unique", en: "invoice numbers are unique", ar: "أرقام الفواتير مش متكررة",
    sql: "SELECT challanNumber, COUNT(*) n FROM FeeInvoice GROUP BY challanNumber HAVING n > 1" },
  { key: "top_up_numbers_are_unique", en: "top-up numbers are unique", ar: "أرقام الشحن مش متكررة",
    sql: "SELECT topUpNumber, COUNT(*) n FROM WalletTopUp WHERE topUpNumber IS NOT NULL GROUP BY topUpNumber HAVING n > 1" },
  { key: "refund_numbers_are_unique", en: "refund numbers are unique", ar: "أرقام الاسترداد مش متكررة",
    sql: "SELECT refundNumber, COUNT(*) n FROM Refund WHERE refundNumber IS NOT NULL GROUP BY refundNumber HAVING n > 1" },
  { key: "each_completed_staff_proof_online_paymen", en: "each completed STAFF/PROOF/ONLINE payment has its wallet top-up (source PAYMENT)", ar: "كل دفعة عدّت على المحفظة (شحن + دفع)",
    sql: "SELECT p.receiptNumber, p.source, p.amount FROM FeePayment p WHERE p.status='COMPLETED' AND p.source IN ('STAFF','PROOF','ONLINE') AND NOT EXISTS (SELECT 1 FROM WalletTopUp t WHERE t.paymentId=p.id AND t.source='PAYMENT' AND t.status='APPROVED')" },
  { key: "a_voided_payment_has_no_approved_top_up_", en: "a VOIDED payment has no APPROVED top-up left", ar: "الإيصال الملغي مالوش شحن معتمد",
    sql: "SELECT p.receiptNumber FROM FeePayment p JOIN WalletTopUp t ON t.paymentId=p.id AND t.source='PAYMENT' WHERE p.status='VOIDED' AND t.status='APPROVED'" },
  { key: "no_wallet_below_zero", en: "no wallet below zero", ar: "مفيش محفظة بالسالب",
    sql: "SELECT studentId, SUM(amount) AS balance FROM WalletTransaction GROUP BY studentId HAVING balance <= -0.01" },
  { key: "each_cash_box_movement_of_a_payment_has_", en: "each cash-box movement of a payment has the payment amount (IN)", ar: "حركة الخزنة لأي دفعة = مبلغ الدفعة (داخل)",
    sql: "SELECT p.receiptNumber, p.amount, m.amount AS moved, m.direction FROM MoneyMovement m JOIN FeePayment p ON p.id=m.feePaymentId WHERE ABS(m.amount - p.amount) >= 0.01 OR m.direction <> 'IN'" },
  { key: "no_cash_box_movement_left_for_a_voided_p", en: "no cash-box movement left for a VOIDED payment", ar: "مفيش حركة خزنة لإيصال ملغي",
    sql: "SELECT p.receiptNumber FROM MoneyMovement m JOIN FeePayment p ON p.id=m.feePaymentId WHERE p.status <> 'COMPLETED'" },
  { key: "a_payment_is_in_the_cash_box_at_most_onc", en: "a payment is in the cash box at most once", ar: "الدفعة في الخزنة مرة واحدة بس",
    sql: "SELECT feePaymentId, COUNT(*) n FROM MoneyMovement WHERE feePaymentId IS NOT NULL GROUP BY feePaymentId HAVING n > 1" },
  { key: "each_wallet_payment_has_its_wallet_debit", en: "each WALLET payment has its wallet debit of the same amount", ar: "الدفع من المحفظة اتخصم من المحفظة بنفس المبلغ",
    sql: "SELECT p.receiptNumber, p.amount FROM FeePayment p WHERE p.status='COMPLETED' AND p.source='WALLET' AND NOT EXISTS (SELECT 1 FROM WalletTransaction w WHERE w.paymentId=p.id AND ABS(w.amount + p.amount) < 0.01)" },
  { key: "a_cancelled_invoice_has_no_completed_pay", en: "a CANCELLED invoice has no completed payment (unless refunded in full)", ar: "الفاتورة الملغية مافيهاش فلوس متبقية",
    sql: "SELECT i.challanNumber, i.paidAmount, i.refundedAmount FROM FeeInvoice i WHERE i.status='CANCELLED' AND i.paidAmount - i.refundedAmount >= 0.01" },
  { key: "a_confirmed_booking_points_to_an_invoice", en: "a CONFIRMED booking points to an invoice that is paid (or free)", ar: "الحجز المتأكد فاتورته مدفوعة (أو مجانية)",
    sql: "SELECT b.id, i.challanNumber, i.totalAmount, i.paidAmount FROM CourseBooking b JOIN FeeInvoice i ON i.id=b.invoiceId WHERE b.status='CONFIRMED' AND i.totalAmount > 0 AND i.paidAmount <= 0" },
  { key: "code_uses_the_uses_recorded", en: "code \"uses\" = the uses recorded", ar: "عدّاد استخدام الكود = الاستخدامات المسجلة",
    sql: "SELECT c.code, c.uses, COUNT(u.id) AS recorded FROM EnrolmentCode c LEFT JOIN EnrolmentCodeUse u ON u.codeId=c.id GROUP BY c.id HAVING c.uses <> recorded" },
  { key: "expense_movement", en: "an expense is in the cash box at most once, with its amount (OUT)", ar: "المصروف في الخزنة مرة واحدة بنفس المبلغ (خارج)",
    sql: "SELECT e.id, e.title, e.amount, COUNT(m.id) n, MAX(m.amount) moved, MAX(m.direction) dir FROM Expense e JOIN MoneyMovement m ON m.expenseId=e.id GROUP BY e.id HAVING n > 1 OR ABS(moved - e.amount) >= 0.01 OR dir <> 'OUT'" },
  { key: "salary_movement", en: "a paid salary is in the cash box at most once, with its net amount (OUT)", ar: "المرتب المدفوع في الخزنة مرة واحدة بصافي المبلغ (خارج)",
    sql: "SELECT s.employeeName, s.month, s.netSalary, COUNT(m.id) n, MAX(m.amount) moved FROM SalarySlip s JOIN MoneyMovement m ON m.salarySlipId=s.id GROUP BY s.id HAVING n > 1 OR ABS(moved - s.netSalary) >= 0.01 OR MAX(m.direction) <> 'OUT'" },
  { key: "refund_movement", en: "a cash refund is in the cash box at most once, with its amount (OUT); wallet refunds never", ar: "الاسترداد الكاش في الخزنة مرة واحدة بنفس المبلغ، واسترداد المحفظة مايدخلش الخزنة",
    sql: "SELECT r.refundNumber, r.method, r.amount, COUNT(m.id) n, MAX(m.amount) moved FROM Refund r JOIN MoneyMovement m ON m.refundId=r.id GROUP BY r.id HAVING n > 1 OR r.method <> 'CASH' OR ABS(moved - r.amount) >= 0.01" },
  { key: "transfer_movements", en: "an approved transfer between accounts = one OUT and one IN of the same amount", ar: "تحويل بين الحسابات = حركة خارجة وحركة داخلة بنفس المبلغ",
    sql: "SELECT t.number, t.amount, SUM(m.direction='OUT') o, SUM(m.direction='IN') i, MIN(m.amount) mn, MAX(m.amount) mx FROM MoneyTransfer t JOIN MoneyMovement m ON m.transferId=t.id WHERE t.status='APPROVED' GROUP BY t.id HAVING o <> 1 OR i <> 1 OR ABS(mn - t.amount) >= 0.01 OR ABS(mx - t.amount) >= 0.01" },
  { key: "transfer_not_approved_no_movement", en: "a transfer not approved moved no money", ar: "تحويل مش معتمد ماحرّكش فلوس",
    sql: "SELECT t.number, t.status FROM MoneyTransfer t JOIN MoneyMovement m ON m.transferId=t.id WHERE t.status <> 'APPROVED'" },
  { key: "movement_positive", en: "every cash-box movement amount is above zero", ar: "كل حركة خزنة مبلغها أكبر من صفر",
    sql: "SELECT id, kind, amount FROM MoneyMovement WHERE amount <= 0 AND kind <> 'ADJUST'" },
  { key: "closed_month_untouched", en: "nothing was written into a CLOSED month after it was closed (payments, expenses, refunds)", ar: "الشهر المقفول ماحدش كتب فيه بعد ما اتقفل (دفعات، مصاريف، استردادات)",
    sql: "SELECT l.ym, 'payment' what, p.receiptNumber ref FROM MonthLock l JOIN FeePayment p ON DATE_FORMAT(CONVERT_TZ(p.paymentDate,'+00:00','+02:00'),'%Y-%m')=l.ym AND p.createdAt > l.lockedAt AND (l.scopeKey='ALL') WHERE l.status='LOCKED' UNION ALL SELECT l.ym, 'expense', e.title FROM MonthLock l JOIN Expense e ON DATE_FORMAT(CONVERT_TZ(e.date,'+00:00','+02:00'),'%Y-%m')=l.ym AND e.createdAt > l.lockedAt AND (l.scopeKey='ALL' OR l.scopeKey=e.campusId) WHERE l.status='LOCKED' UNION ALL SELECT l.ym, 'refund', r.refundNumber FROM MonthLock l JOIN Refund r ON r.approvedAt IS NOT NULL AND DATE_FORMAT(CONVERT_TZ(r.approvedAt,'+00:00','+02:00'),'%Y-%m')=l.ym AND r.approvedAt > l.lockedAt AND l.scopeKey='ALL' WHERE l.status='LOCKED'" },
  { key: "partner_statement_paid", en: "a partner statement is never paid beyond what it says is due", ar: "كشف الشريك مايتدفعش أكتر من المستحق",
    sql: "SELECT s.number, s.totalDue, SUM(CASE WHEN p.direction='PARTNER_TO_TECHNOVA' THEN p.amount ELSE -p.amount END) paid FROM PartnerStatement s JOIN PartnerStatementPayment p ON p.statementId=s.id GROUP BY s.id HAVING ABS(paid) - ABS(s.totalDue) >= 0.01" },
  { key: "withdrawal_numbers_unique", en: "withdrawal numbers are unique", ar: "أرقام السحب مش متكررة",
    sql: "SELECT withdrawalNumber, COUNT(*) n FROM WalletWithdrawal WHERE withdrawalNumber IS NOT NULL GROUP BY withdrawalNumber HAVING n > 1" },
  { key: "withdrawal_wallet_debit", en: "an approved withdrawal took its amount out of the wallet once", ar: "السحب المعتمد اتخصم من المحفظة مرة واحدة بمبلغه",
    sql: "SELECT w.withdrawalNumber, w.amount, COUNT(t.id) n FROM WalletWithdrawal w LEFT JOIN WalletTransaction t ON t.withdrawalId=w.id WHERE w.status='APPROVED' GROUP BY w.id HAVING n <> 1 OR ABS(MIN(t.amount) + w.amount) >= 0.01" },
  { key: "refund_wallet_credit", en: "a wallet refund added its amount to the wallet once", ar: "استرداد المحفظة اتضاف للمحفظة مرة واحدة بمبلغه",
    sql: "SELECT r.refundNumber, r.amount, COUNT(t.id) n FROM Refund r LEFT JOIN WalletTransaction t ON t.refundId=r.id WHERE r.status='APPROVED' AND r.method='WALLET' GROUP BY r.id HAVING n <> 1 OR ABS(MIN(t.amount) - r.amount) >= 0.01" },
]

export interface MoneyRuleResult { key: string; en: string; ar: string; bad: number; sample: Record<string, unknown>[]; error?: string }

/** Runs every rule (read-only). `bad` = rows breaking the rule (-1 when the query itself failed). */
export async function runMoneyRules(db: Pick<PrismaClient, '$queryRawUnsafe'>): Promise<MoneyRuleResult[]> {
  const out: MoneyRuleResult[] = []
  for (const r of MONEY_RULES) {
    try {
      const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(r.sql)
      const clean = rows.slice(0, 5).map((x) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))) as Record<string, unknown>)
      out.push({ key: r.key, en: r.en, ar: r.ar, bad: rows.length, sample: clean })
    } catch (e) {
      out.push({ key: r.key, en: r.en, ar: r.ar, bad: -1, sample: [], error: (e as Error).message.split(String.fromCharCode(10))[0].slice(0, 200) })
    }
  }
  return out
}
