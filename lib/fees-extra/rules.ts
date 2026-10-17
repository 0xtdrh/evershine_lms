/**
 * FIN-2 extra fees + platform fee (2026-10-17) — pure rules, no Prisma.
 * A fee type has a company default (REQUIRED / OPTIONAL) and may have rules for a partner, place, track, course,
 * level, group or one student; the MOST SPECIFIC rule wins (student > group > level > course > track > place >
 * partner > default). EXEMPT = never charged. Frequency decides the period, so a fee is never charged twice:
 * MONTHLY = every new monthly invoice, PER_LEVEL = once per level, YEARLY = once per calendar year,
 * ONCE = once ever (registration), MANUAL = only when staff add it.
 */

export const FEE_FREQUENCIES = ['MONTHLY', 'PER_LEVEL', 'YEARLY', 'ONCE', 'MANUAL'] as const
export type FeeFrequency = (typeof FEE_FREQUENCIES)[number]
export const FEE_MODES = ['REQUIRED', 'OPTIONAL', 'EXEMPT'] as const
export type FeeMode = (typeof FEE_MODES)[number]
export const ON_UNPAID = ['REMIND', 'LOCK_LMS', 'BLOCK_NEXT', 'COUNT_WARNING'] as const
export type OnUnpaid = (typeof ON_UNPAID)[number]
export const FEE_SCOPES = ['PARTNER', 'CAMPUS', 'TRACK', 'COURSE', 'LEVEL', 'GROUP', 'STUDENT'] as const
export type FeeScope = (typeof FEE_SCOPES)[number]

export const FREQUENCY_LABEL: Record<FeeFrequency, [string, string]> = {
  MONTHLY: ['Every month', 'كل شهر'], PER_LEVEL: ['Once per level', 'مرة لكل مستوى'], YEARLY: ['Once a year', 'مرة في السنة'],
  ONCE: ['Once (on joining)', 'مرة واحدة (عند التسجيل)'], MANUAL: ['Only when staff add it', 'لما الموظف يضيفه بس'],
}
export const MODE_LABEL: Record<FeeMode, [string, string]> = { REQUIRED: ['Required', 'إجباري'], OPTIONAL: ['Optional', 'اختياري'], EXEMPT: ['Not charged', 'معفي'] }
export const ON_UNPAID_LABEL: Record<OnUnpaid, [string, string]> = {
  REMIND: ['Reminder only', 'تذكير بس'],
  LOCK_LMS: ['Lock the learning platform', 'قفل المنصة التعليمية'],
  BLOCK_NEXT: ['Cannot move to the next month / level', 'مايعدّيش للشهر أو المستوى اللي بعده'],
  COUNT_WARNING: ['Counts in the mid-month payment warning', 'تتحسب في تحذير نص الشهر'],
}
export const SCOPE_LABEL: Record<FeeScope, [string, string]> = {
  PARTNER: ['Partner', 'شريك'], CAMPUS: ['Branch / place', 'فرع / مكان'], TRACK: ['Track', 'تراك'], COURSE: ['Course', 'كورس'],
  LEVEL: ['Level', 'مستوى'], GROUP: ['Group', 'جروب'], STUDENT: ['Student', 'طالب'],
}

/** Most specific first. */
const ORDER: FeeScope[] = ['STUDENT', 'GROUP', 'LEVEL', 'COURSE', 'TRACK', 'CAMPUS', 'PARTNER']

export interface FeeTypeLite { amount: number; frequency: FeeFrequency; defaultMode: FeeMode | string; onUnpaid: OnUnpaid | string }
export interface FeeRuleLite { scopeType: FeeScope | string; scopeId: string; mode: FeeMode | string; amount: number | null; frequency: string | null; onUnpaid: string | null }
export type FeeContext = Partial<Record<FeeScope, string | null>>

export interface ResolvedFee { mode: FeeMode; amount: number; frequency: FeeFrequency; onUnpaid: OnUnpaid; from: FeeScope | 'DEFAULT' }

export function resolveFee(type: FeeTypeLite, rules: FeeRuleLite[], ctx: FeeContext): ResolvedFee {
  for (const scope of ORDER) {
    const id = ctx[scope]
    if (!id) continue
    const r = rules.find((x) => x.scopeType === scope && x.scopeId === id)
    if (r) {
      return {
        mode: r.mode as FeeMode, amount: r.amount ?? type.amount, frequency: (r.frequency as FeeFrequency) || type.frequency,
        onUnpaid: (r.onUnpaid as OnUnpaid) || (type.onUnpaid as OnUnpaid), from: scope,
      }
    }
  }
  return { mode: type.defaultMode as FeeMode, amount: type.amount, frequency: type.frequency, onUnpaid: type.onUnpaid as OnUnpaid, from: 'DEFAULT' }
}

/** The period a charge belongs to (the unique key that stops charging twice). null = MANUAL (always a new charge). */
export function periodKey(frequency: FeeFrequency, at: { date: Date; levelId?: string | null }): string | null {
  const y = at.date.getUTCFullYear()
  switch (frequency) {
    case 'MONTHLY': return `${y}-${String(at.date.getUTCMonth() + 1).padStart(2, '0')}`
    case 'PER_LEVEL': return at.levelId ? `L:${at.levelId}` : null
    case 'YEARLY': return `Y:${y}`
    case 'ONCE': return 'ONCE'
    case 'MANUAL': return null
  }
}

/** Which consequences are active for a student: from charges whose invoice is still unpaid after its due date. */
export function activeConsequences(charges: { onUnpaid: string; invoice: { status: string; dueDate: Date | string; totalAmount: number; paidAmount: number } }[], now = new Date()): Set<OnUnpaid> {
  const out = new Set<OnUnpaid>()
  for (const c of charges) {
    const i = c.invoice
    const unpaid = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status) && i.totalAmount - i.paidAmount > 0.001
    if (unpaid && new Date(i.dueDate).getTime() < now.getTime()) out.add(c.onUnpaid as OnUnpaid)
  }
  return out
}

export interface FeesSettings {
  /** what the wallet pays first when both are open: the fees or the monthly price */
  payFirst: 'FEES' | 'TUITION'
}
export const DEFAULT_FEES_SETTINGS: FeesSettings = { payFirst: 'TUITION' }
