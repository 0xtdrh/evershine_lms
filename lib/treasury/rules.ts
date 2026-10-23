/**
 * FIN-1 money accounts (2026-10-17) — pure rules, no Prisma.
 * Every payment / top-up / refund / withdrawal / expense / salary / partner payment becomes a movement on an account.
 * The account is chosen from the payment method + branch (Settings → Payments): a branch route wins over an
 * "every branch" route; no route = the movement is "not placed" until one is set.
 */

export const ACCOUNT_KINDS = ['CASH', 'BANK', 'INSTAPAY', 'EWALLET', 'GATEWAY', 'OTHER'] as const
export type AccountKind = (typeof ACCOUNT_KINDS)[number]
export const ACCOUNT_KIND_LABEL: Record<AccountKind, [string, string]> = {
  CASH: ['Cash box', 'خزنة كاش'], BANK: ['Bank account', 'حساب بنك'], INSTAPAY: ['InstaPay', 'InstaPay'],
  EWALLET: ['Mobile wallet', 'محفظة موبايل'], GATEWAY: ['Online gateway', 'دفع أونلاين'], OTHER: ['Other', 'أخرى'],
}

export const MOVEMENT_KINDS = ['PAYMENT', 'TOPUP', 'REFUND', 'WITHDRAWAL', 'EXPENSE', 'SALARY', 'PARTNER', 'TRANSFER', 'ADJUST'] as const
export type MovementKind = (typeof MOVEMENT_KINDS)[number]
export const MOVEMENT_KIND_LABEL: Record<MovementKind, [string, string]> = {
  PAYMENT: ['Invoice payment', 'دفع فاتورة'], TOPUP: ['Wallet top-up', 'شحن محفظة'], REFUND: ['Refund (cash)', 'استرداد كاش'],
  WITHDRAWAL: ['Wallet withdrawal', 'سحب من المحفظة'], EXPENSE: ['Expense', 'مصروف'], SALARY: ['Salary', 'مرتب'],
  PARTNER: ['Partner payment', 'دفعة شريك'], TRANSFER: ['Transfer', 'تحويل'], ADJUST: ['Count difference', 'فرق جرد'],
}

export interface Route { method: string; campusId: string | null; accountId: string }

const norm = (s: string) => s.trim().toLowerCase()

/** The account for a payment method in a branch: the branch's own route first, then the "every branch" one. */
export function pickAccount(routes: Route[], method: string | null | undefined, campusId: string | null | undefined): string | null {
  if (!method) return null
  const m = norm(method)
  const same = routes.filter((r) => norm(r.method) === m)
  return (campusId ? same.find((r) => r.campusId === campusId) : undefined)?.accountId ?? same.find((r) => !r.campusId)?.accountId ?? null
}

export interface MovementLite { direction: 'IN' | 'OUT' | string; amount: number; date: Date | string }

/** Balance = opening balance + money in − money out, counting movements from the opening date on. */
export function balanceOf(opening: number, openingDate: Date | string, movements: MovementLite[], until?: Date): number {
  const from = new Date(openingDate).getTime()
  const to = until ? until.getTime() : Infinity
  let b = opening
  for (const m of movements) {
    const t = new Date(m.date).getTime()
    if (t < from || t > to) continue
    b += m.direction === 'IN' ? m.amount : -m.amount
  }
  return Math.round(b * 100) / 100
}

/** End-of-day count: difference = counted − expected; small differences inside the tolerance are approved at once. */
export function countOutcome(expected: number, counted: number, tolerance: number) {
  const difference = Math.round((counted - expected) * 100) / 100
  return { difference, autoApprove: Math.abs(difference) <= Math.max(0, tolerance) }
}

export interface TreasurySettings {
  /** cash boxes should be counted every day (a task appears after this hour, Cairo time) */
  dailyCloseRequired: boolean
  closeAfterHour: number
  /** differences up to this amount are approved automatically */
  tolerance: number
  /** transfers need a second person's approval */
  transferNeedsApproval: boolean
  /** a branch person may send money from their branch account to a company account (e.g. deposit cash in the bank);
   *  such a transfer always waits for someone who sees every place (2026-10-24, owner) */
  branchToCompany: boolean
}
export const DEFAULT_TREASURY_SETTINGS: TreasurySettings = { dailyCloseRequired: true, closeAfterHour: 18, tolerance: 0, transferNeedsApproval: true, branchToCompany: true }

/** Built-in expense categories (the old fixed list) — the owner can rename, hide or add more. */
export const DEFAULT_EXPENSE_CATEGORIES: { key: string; nameEn: string; nameAr: string }[] = [
  { key: 'UTILITIES', nameEn: 'Utilities (electricity, water, internet)', nameAr: 'مرافق (كهربا، مية، نت)' },
  { key: 'SALARIES', nameEn: 'Salaries (non-teaching staff)', nameAr: 'مرتبات (غير المدربين)' },
  { key: 'MAINTENANCE', nameEn: 'Maintenance', nameAr: 'صيانة' },
  { key: 'STATIONERY', nameEn: 'Stationery & supplies', nameAr: 'أدوات مكتبية ومستلزمات' },
  { key: 'EQUIPMENT', nameEn: 'Equipment & kits', nameAr: 'أجهزة وكيتات' },
  { key: 'TRANSPORT', nameEn: 'Transport', nameAr: 'مواصلات' },
  { key: 'EVENTS', nameEn: 'Events', nameAr: 'فعاليات' },
  { key: 'MISCELLANEOUS', nameEn: 'Other', nameAr: 'أخرى' },
]
export const ENUM_CATEGORIES = DEFAULT_EXPENSE_CATEGORIES.map((c) => c.key)
