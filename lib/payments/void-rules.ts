/**
 * Cancel a payment recorded by mistake (2026-11-07, owner). Pure rules, tests in tests/payment-void.test.ts.
 * Void ≠ refund: a refund is money that really came in and goes back out (both stay in the books); a void says the
 * money never came (wrong amount, wrong student, saved twice): the payment is marked VOIDED and everything it did is undone.
 */

export interface VoidSettings { enabled: boolean; maxDays: number }
export const DEFAULT_VOID_SETTINGS: VoidSettings = { enabled: true, maxDays: 7 }
export function cleanVoidSettings(v: Partial<VoidSettings> | null | undefined): VoidSettings {
  const d = Number(v?.maxDays)
  return { enabled: v?.enabled !== false, maxDays: Number.isInteger(d) && d >= 1 && d <= 60 ? d : DEFAULT_VOID_SETTINGS.maxDays }
}

/** Default approvers (RBAC payment_voids:approve): Super Admin, Admin, Branch manager. Never the person who asked (owner: «مش نفس الشخص»). */

export type VoidProblem = 'OFF' | 'NOT_COMPLETED' | 'ONLINE' | 'TOO_OLD' | 'REFUNDED' | 'RECONCILED'

export const VOID_PROBLEM_TEXT: Record<VoidProblem, { en: string; ar: string }> = {
  OFF: { en: 'Cancelling payments is switched off', ar: 'إلغاء الدفعات مقفول من الإعدادات' },
  NOT_COMPLETED: { en: 'This payment is already cancelled', ar: 'الدفعة دي ملغية أصلًا' },
  ONLINE: { en: 'An online payment really reached the gateway: use a refund instead', ar: 'الدفع الأونلاين الفلوس وصلت فعلًا: اعمل استرداد بدل الإلغاء' },
  TOO_OLD: { en: 'Too old to cancel: use a refund instead', ar: 'الدفعة أقدم من المدة المسموحة للإلغاء: اعمل استرداد' },
  REFUNDED: { en: 'Money was already refunded on this invoice: cancel the refund first', ar: 'فيه استرداد اتعمل على الفاتورة دي: الغي الاسترداد الأول' },
  RECONCILED: { en: 'This payment was matched with the bank statement: undo the match first', ar: 'الدفعة دي اتطابقت مع كشف البنك: الغي المطابقة الأول' },
}

export function voidProblem(i: {
  settings: VoidSettings
  status: string
  source: string | null
  createdAt: Date
  now: Date
  amount: number
  invoicePaid: number
  invoiceRefunded: number
  reconciled: boolean
}): VoidProblem | null {
  if (!i.settings.enabled) return 'OFF'
  if (i.status !== 'COMPLETED') return 'NOT_COMPLETED'
  if (i.source === 'ONLINE') return 'ONLINE'
  if (i.now.getTime() - i.createdAt.getTime() > i.settings.maxDays * 86_400_000) return 'TOO_OLD'
  if (i.invoicePaid - i.amount < i.invoiceRefunded - 0.001) return 'REFUNDED'
  if (i.reconciled) return 'RECONCILED'
  return null
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** The invoice after the payment is taken off. */
export function invoiceAfterVoid(i: { total: number; paid: number; amount: number; dueDate: Date; now: Date }) {
  const paid = Math.max(0, r2(i.paid - i.amount))
  const status = paid >= i.total - 0.001 && i.total > 0 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : i.dueDate.getTime() < i.now.getTime() ? 'OVERDUE' : 'ISSUED'
  return { paid, status: status as 'PAID' | 'PARTIALLY_PAID' | 'OVERDUE' | 'ISSUED' }
}

/** The student's fee summary after the payment is taken off. */
export function studentAfterVoid(i: { paid: number; due: number; amount: number }) {
  const paid = Math.max(0, r2(i.paid - i.amount))
  const due = r2(i.due + i.amount)
  return { paid, due, feeStatus: (due <= 0 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'PENDING') as 'PAID' | 'PARTIALLY_PAID' | 'PENDING' }
}

/** canApprove = RBAC payment_voids:approve (Permissions page can change who). */
export function canDecide(i: { canApprove: boolean; userId: string; requestedById: string }): 'OK' | 'OWN' | 'ROLE' {
  if (!i.canApprove) return 'ROLE'
  if (i.userId === i.requestedById) return 'OWN'
  return 'OK'
}
