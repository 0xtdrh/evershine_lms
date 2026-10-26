/**
 * a03 month close (2026-10-26) — pure rules, no Prisma (tests/month-close.test.ts).
 *
 * Owner decisions: every money row belongs to the month it really happened in (Cairo time): a payment = the day the
 * money came in, an invoice = the day it was made, an expense = its date, a refund / top-up / withdrawal = the day it
 * was approved, a salary slip = its salary month. A month can be closed for the whole company ("ALL") or for one branch;
 * by hand (Admin / Accountant) or automatically on a set day; only a Super Admin reopens it (with a reason).
 * A late payment on an old invoice is fine: it is dated today, so it lands in today's month.
 */

import { cairoYmd } from '../dates/cairo'

export const ALL_SCOPE = 'ALL'
export const YM = /^\d{4}-(0[1-9]|1[0-2])$/

export interface LockRow { ym: string; scopeKey: string }

export interface MonthCloseSettings {
  /** close last month automatically (company-wide) on autoLockDay, when nothing is left pending */
  autoLock: boolean
  autoLockDay: number
  /** from this day of the month, "last month is not closed yet" shows in "your work today" */
  remindDay: number
}
export const DEFAULT_MONTH_CLOSE_SETTINGS: MonthCloseSettings = { autoLock: false, autoLockDay: 5, remindDay: 3 }

export function cleanSettings(v: Partial<MonthCloseSettings>, base: MonthCloseSettings = DEFAULT_MONTH_CLOSE_SETTINGS): MonthCloseSettings {
  const day = (n: unknown, d: number) => { const x = Number(n); return Math.min(28, Math.max(1, Math.round(Number.isFinite(x) ? x : d))) }
  return {
    autoLock: v.autoLock === undefined ? base.autoLock : !!v.autoLock,
    autoLockDay: v.autoLockDay === undefined ? base.autoLockDay : day(v.autoLockDay, base.autoLockDay),
    remindDay: v.remindDay === undefined ? base.remindDay : day(v.remindDay, base.remindDay),
  }
}

/** The Cairo month (YYYY-MM) of an instant. A @db.Date value (UTC midnight) keeps its own day. */
export function ymOf(at: Date): string {
  const d = cairoYmd(at)
  return `${d.y}-${String(d.m).padStart(2, '0')}`
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const i = y * 12 + (m - 1) + n
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
}

/** Cairo offset (+2 or +3 hours) at an instant, in ms. */
function cairoOffset(at: Date): number {
  const d = cairoYmd(at)
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
  const h = Number(parts.find((p) => p.type === 'hour')?.value), mi = Number(parts.find((p) => p.type === 'minute')?.value)
  return Date.UTC(d.y, d.m - 1, d.d, h, mi) - Math.floor(at.getTime() / 60_000) * 60_000
}

/**
 * The month as instants: `from` / `to` = Cairo midnight of the 1st of this / next month (for DateTime columns);
 * `dayFrom` / `dayTo` = UTC midnight of those days (for @db.Date columns). `to` / `dayTo` are exclusive.
 */
export function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const dayFrom = new Date(Date.UTC(y, m - 1, 1)), dayTo = new Date(Date.UTC(y, m, 1))
  const at = (d: Date) => new Date(d.getTime() - cairoOffset(new Date(d.getTime() - 3 * 3_600_000)))
  return { from: at(dayFrom), to: at(dayTo), dayFrom, dayTo }
}

export const currentYm = (now: Date = new Date()) => ymOf(now)

/** Only a month that is over can be closed. */
export const canLockYm = (ym: string, now: Date = new Date()) => YM.test(ym) && ym < currentYm(now)

/**
 * Is a row of this month closed? `campusIds` = the branches the row belongs to ([] = a company row — closed only by a
 * company-wide close).
 */
export function isLocked(locks: LockRow[], ym: string, campusIds: (string | null | undefined)[]): boolean {
  return locks.some((l) => l.ym === ym && (l.scopeKey === ALL_SCOPE || campusIds.includes(l.scopeKey)))
}

/** The last instant that can belong to a closed month (to skip the check for newer rows quickly). */
export function latestLockedEnd(locks: LockRow[]): Date | null {
  if (!locks.length) return null
  const last = locks.reduce((a, l) => (l.ym > a ? l.ym : a), locks[0].ym)
  return new Date(monthRange(last).to.getTime() + 86_400_000)
}

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthName = (ym: string, lang: 'en' | 'ar') => {
  const [y, m] = ym.split('-').map(Number)
  return `${(lang === 'ar' ? AR_MONTHS : EN_MONTHS)[m - 1]} ${y}`
}

export const refusalMessage = (ym: string) =>
  `${monthName(ym, 'en')} is closed (month close) — nothing dated in it can be added, changed or deleted. A Super Admin can reopen it. · شهر ${monthName(ym, 'ar')} مقفول — مينفعش تضيف أو تعدّل أو تمسح حاجة بتاريخه. الـ Super Admin بس يقدر يفتحه.`

/**
 * What the guard protects. `dates` = the column(s) that say which month a row belongs to (the first one set wins);
 * `free` = columns that may still change on a closed row (follow-up work done today, e.g. paying last month's salary);
 * `frozen` = values a free column may NOT take on a closed row (cancelling it); `createDeleteOnly` = updates are checked
 * by the screens that edit by hand (invoices: payments, refunds and transfers keep updating old invoices on purpose).
 */
export interface ModelRule { dates: string[]; free?: string[]; frozen?: Record<string, unknown[]>; createDeleteOnly?: boolean; companyOnly?: boolean }

export const GUARDED: Record<string, ModelRule> = {
  FeePayment: { dates: ['paymentDate', 'createdAt'] },
  FeeInvoice: { dates: ['createdAt'], createDeleteOnly: true },
  Refund: { dates: ['approvedAt'] },
  Expense: { dates: ['date'], free: ['receiptUrl', 'notes'] },
  SalarySlip: {
    dates: ['salaryPeriodStart'], companyOnly: true,
    free: ['status', 'paymentDate', 'paymentReference', 'paymentSource', 'approvalStatus', 'approvalNote', 'approvedById', 'approvedAsRole', 'notes', 'bankName', 'accountNumber'],
    frozen: { status: ['CANCELLED'], approvalStatus: ['REJECTED'] },
  },
  WalletTopUp: { dates: ['approvedAt'], free: ['remarks'] },
  WalletWithdrawal: { dates: ['approvedAt'] },
  MoneyTransfer: { dates: ['date'], free: ['note'] },
  CashCount: { dates: ['date'], free: ['note'] },
  PartnerStatementPayment: { dates: ['paidAt'], free: ['note', 'reference'] },
}

const asDate = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null
  const d = v instanceof Date ? v : typeof v === 'string' || typeof v === 'number' ? new Date(v) : null
  return d && !Number.isNaN(d.getTime()) ? d : null
}

/** The month a row belongs to (null = not dated yet, e.g. a refund still waiting for approval). */
export function rowYm(model: string, row: Record<string, unknown>): string | null {
  const rule = GUARDED[model]
  if (!rule) return null
  for (const f of rule.dates) {
    const d = asDate(row[f])
    if (d) return ymOf(d)
  }
  return null
}

/** For the guard: does this update touch anything that a closed row must keep? */
export function touchesClosedFields(model: string, data: Record<string, unknown>, before: Record<string, unknown>): boolean {
  const rule = GUARDED[model]
  if (!rule) return false
  const free = new Set([...(rule.free ?? []), 'updatedAt'])
  const plain = (x: unknown) => JSON.stringify(x instanceof Date ? x.toISOString() : x === undefined ? null : typeof x === 'object' && x !== null && 'toNumber' in x ? Number(x) : x)
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue
    const scalar = v === null || typeof v !== 'object' || v instanceof Date
    if (scalar && plain(v) === plain(before[k])) continue // written but not changed
    if (!free.has(k)) return true
    if (rule.frozen?.[k]?.includes(v)) return true
  }
  return false
}

// ── the checklist before closing ─────────────────────────────────────────────

export type PendingKey = 'proofs' | 'refunds' | 'topUps' | 'withdrawals' | 'expenses' | 'transfers' | 'counts' | 'slips' | 'notPlaced'
export const PENDING_LABELS: Record<PendingKey, { en: string; ar: string; href: string }> = {
  proofs: { en: 'Payment receipts still to check', ar: 'إيصالات دفع لسه متراجعتش', href: '/dashboard/fees' },
  refunds: { en: 'Refund requests waiting', ar: 'طلبات استرداد مستنية', href: '/dashboard/refunds' },
  topUps: { en: 'Wallet top-ups to approve', ar: 'شحن محافظ مستني موافقة', href: '/dashboard/wallet?tab=proofs' },
  withdrawals: { en: 'Wallet withdrawals to decide', ar: 'سحب من المحافظ مستني قرار', href: '/dashboard/wallet?tab=withdrawals' },
  expenses: { en: 'Expenses not approved', ar: 'مصاريف لسه متوافقش عليها', href: '/dashboard/accountant/expenses' },
  transfers: { en: 'Transfers between accounts to approve', ar: 'تحويلات بين الحسابات مستنية موافقة', href: '/dashboard/treasury?tab=transfers' },
  counts: { en: 'Cash count differences to approve', ar: 'فروق جرد مستنية موافقة', href: '/dashboard/treasury?tab=counts' },
  slips: { en: 'Salary slips of the month waiting for approval', ar: 'قسايم مرتبات الشهر مستنية موافقة', href: '/dashboard/accountant/salary-slips' },
  notPlaced: { en: 'Money not placed in an account', ar: 'فلوس مش متسجلة على حساب', href: '/dashboard/admin/finance-settings#accounts' },
}
export type Pending = Partial<Record<PendingKey, number>>
export const pendingTotal = (p: Pending) => Object.values(p).reduce<number>((a, n) => a + (n ?? 0), 0)

/** Should the daily job close last month now? Only company-wide, only when it was never closed or reopened, nothing pending. */
export function autoLockDue(i: { settings: MonthCloseSettings; now: Date; lastMonthRow: { status: string } | null; pending: Pending }): boolean {
  if (!i.settings.autoLock) return false
  if (cairoYmd(i.now).d < i.settings.autoLockDay) return false
  if (i.lastMonthRow) return false // already closed, or reopened on purpose by a Super Admin
  return pendingTotal(i.pending) === 0
}
