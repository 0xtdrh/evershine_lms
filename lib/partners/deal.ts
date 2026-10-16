/**
 * Partners part 1 (2026-10-16) — the money deal with a partner, built from pieces, and its calculation for a period.
 * Pure (no database), tested in tests/partners-deal.test.ts. docs/design-locations-and-partners.md §12.
 *
 * Who collects decides what the pieces mean:
 * - TECHNOVA collects from the parents → the pieces are the PARTNER's share (TechNova pays the partner);
 * - PARTNER collects → the pieces are TECHNOVA's share (the partner pays TechNova);
 * - INSTITUTION (no parents pay) → the pieces are what the institution pays TechNova.
 * Extras (tools, transport, …) are added on top for whoever pays them.
 * The result is the balance for TechNova: positive = TechNova should RECEIVE it, negative = TechNova should PAY it.
 */

export const COLLECTORS = ['TECHNOVA', 'PARTNER', 'INSTITUTION'] as const
export type Collector = (typeof COLLECTORS)[number]

export const COMPONENT_KINDS = ['PERCENT', 'FIXED_MONTHLY', 'PER_SESSION', 'PER_HOUR', 'PER_STUDENT_MONTH', 'PER_GROUP_MONTH', 'PER_TERM', 'MINIMUM'] as const
export type ComponentKind = (typeof COMPONENT_KINDS)[number]

export interface DealComponent {
  kind: ComponentKind
  value: number
  /** PERCENT only: NET = money collected − refunds (default); GROSS = NET + discounts given */
  base?: 'NET' | 'GROSS'
  /** PER_HOUR only: hours in one session (default 1) */
  hoursPerSession?: number
}

export interface DealExtra { label: string; amount: number; per: 'ONCE' | 'MONTH' | 'SESSION'; payer: 'TECHNOVA' | 'PARTNER' }

export interface Deal {
  collector: Collector
  components: DealComponent[]
  extras?: DealExtra[] | null
  countPartnerCancelled: boolean
  period: 'MONTH' | 'TERM'
}

/** What happened in the period (gathered from the system by lib/partners/statements). */
export interface DealFacts {
  /** money paid on the invoices of these places in the period */
  collected: number
  /** refunds approved in the period on those invoices */
  refunds: number
  /** discounts given on invoices of these places issued in the period */
  discounts: number
  sessionsHeld: number
  sessionsCancelledByPartner: number
  /** students (named) + children of unnamed classes active in the period */
  students: number
  /** groups that had at least one session in the period */
  groups: number
  /** length of the period in months (≥ 1 for a statement) */
  months: number
}

export interface DealLine { label: string; labelAr: string; quantity: number; rate: number; amount: number; payer: 'TECHNOVA' | 'PARTNER' }
export interface DealResult { lines: DealLine[]; shareTotal: number; balanceForTechNova: number; sessionsCounted: number; base: { net: number; gross: number } }

const r2 = (n: number) => Math.round(n * 100) / 100

export const KIND_LABELS: Record<ComponentKind, { en: string; ar: string }> = {
  PERCENT: { en: 'Percentage of revenue', ar: 'نسبة من الإيراد' },
  FIXED_MONTHLY: { en: 'Fixed amount per month', ar: 'مبلغ ثابت في الشهر' },
  PER_SESSION: { en: 'Per session', ar: 'على كل حصة' },
  PER_HOUR: { en: 'Per hour', ar: 'على كل ساعة' },
  PER_STUDENT_MONTH: { en: 'Per student per month', ar: 'على كل طالب في الشهر' },
  PER_GROUP_MONTH: { en: 'Per group per month', ar: 'على كل جروب في الشهر' },
  PER_TERM: { en: 'Amount per term', ar: 'مبلغ للترم' },
  MINIMUM: { en: 'Guaranteed minimum', ar: 'حد أدنى مضمون' },
}

export const COLLECTOR_LABELS: Record<Collector, { en: string; ar: string; share: { en: string; ar: string } }> = {
  TECHNOVA: { en: 'TechNova collects from parents', ar: 'TechNova بتحصّل من أولياء الأمور', share: { en: 'Partner share', ar: 'نصيب الشريك' } },
  PARTNER: { en: 'The partner collects from parents', ar: 'الشريك بيحصّل من أولياء الأمور', share: { en: 'TechNova share', ar: 'نصيب TechNova' } },
  INSTITUTION: { en: 'The institution pays TechNova', ar: 'المؤسسة بتدفع لـ TechNova', share: { en: 'Due from the institution', ar: 'المطلوب من المؤسسة' } },
}

/** The share pieces (not extras) for the period. */
export function computeDeal(deal: Deal, f: DealFacts): DealResult {
  const net = r2(f.collected - f.refunds)
  const gross = r2(net + f.discounts)
  const sessions = f.sessionsHeld + (deal.countPartnerCancelled ? f.sessionsCancelledByPartner : 0)
  const months = Math.max(1, f.months)
  // the pieces are paid by whoever does NOT receive them
  const sharePayer: 'TECHNOVA' | 'PARTNER' = deal.collector === 'TECHNOVA' ? 'TECHNOVA' : 'PARTNER'
  const lines: DealLine[] = []
  let minimum: number | null = null
  for (const c of deal.components) {
    const v = Number(c.value) || 0
    const L = KIND_LABELS[c.kind]
    switch (c.kind) {
      case 'PERCENT': {
        const b = c.base === 'GROSS' ? gross : net
        lines.push({ label: `${v}% of ${c.base === 'GROSS' ? 'revenue before discounts' : 'net revenue'}`, labelAr: `${v}% من ${c.base === 'GROSS' ? 'الإيراد قبل الخصومات' : 'صافي الإيراد'}`, quantity: b, rate: v / 100, amount: r2((b * v) / 100), payer: sharePayer })
        break
      }
      case 'FIXED_MONTHLY': lines.push({ label: L.en, labelAr: L.ar, quantity: months, rate: v, amount: r2(months * v), payer: sharePayer }); break
      case 'PER_SESSION': lines.push({ label: L.en, labelAr: L.ar, quantity: sessions, rate: v, amount: r2(sessions * v), payer: sharePayer }); break
      case 'PER_HOUR': {
        const h = r2(sessions * (c.hoursPerSession && c.hoursPerSession > 0 ? c.hoursPerSession : 1))
        lines.push({ label: L.en, labelAr: L.ar, quantity: h, rate: v, amount: r2(h * v), payer: sharePayer })
        break
      }
      case 'PER_STUDENT_MONTH': lines.push({ label: L.en, labelAr: L.ar, quantity: f.students * months, rate: v, amount: r2(f.students * months * v), payer: sharePayer }); break
      case 'PER_GROUP_MONTH': lines.push({ label: L.en, labelAr: L.ar, quantity: f.groups * months, rate: v, amount: r2(f.groups * months * v), payer: sharePayer }); break
      case 'PER_TERM': lines.push({ label: L.en, labelAr: L.ar, quantity: 1, rate: v, amount: r2(v), payer: sharePayer }); break
      case 'MINIMUM': minimum = Math.max(minimum ?? 0, v); break
    }
  }
  let shareTotal = r2(lines.reduce((s, l) => s + l.amount, 0))
  if (minimum !== null && shareTotal < minimum) {
    lines.push({ label: 'Top-up to the guaranteed minimum', labelAr: 'تكملة للحد الأدنى المضمون', quantity: 1, rate: r2(minimum - shareTotal), amount: r2(minimum - shareTotal), payer: sharePayer })
    shareTotal = r2(minimum)
  }
  for (const e of deal.extras ?? []) {
    const qty = e.per === 'MONTH' ? months : e.per === 'SESSION' ? sessions : 1
    lines.push({ label: e.label, labelAr: e.label, quantity: qty, rate: Number(e.amount) || 0, amount: r2(qty * (Number(e.amount) || 0)), payer: e.payer })
  }
  const balanceForTechNova = r2(lines.reduce((s, l) => s + (l.payer === 'PARTNER' ? l.amount : -l.amount), 0))
  return { lines, shareTotal, balanceForTechNova, sessionsCounted: sessions, base: { net, gross } }
}

/** A deal that can be saved: known pieces, sensible numbers. */
export function dealProblem(d: Deal): string | null {
  if (!COLLECTORS.includes(d.collector)) return 'Choose who collects from the parents'
  if (!d.components.length) return 'Add at least one piece to the deal'
  for (const c of d.components) {
    if (!COMPONENT_KINDS.includes(c.kind)) return 'Unknown piece in the deal'
    if (!(Number(c.value) >= 0)) return 'Amounts must be zero or more'
    if (c.kind === 'PERCENT' && Number(c.value) > 100) return 'A percentage cannot be more than 100'
  }
  if (d.collector === 'INSTITUTION' && d.components.some((c) => c.kind === 'PERCENT')) return 'With the institution paying there is no parents’ revenue to take a percentage of'
  for (const e of d.extras ?? []) if (!e.label?.trim() || !(Number(e.amount) >= 0)) return 'Each extra needs a name and an amount'
  return null
}

/** Months between two dates for a statement (a calendar month = 1; never less than 1). */
export function periodMonths(from: Date, to: Date): number {
  const days = Math.round((Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) / 86_400_000) + 1
  return Math.max(1, Math.round(days / 30.4))
}

/** The deal that applies on a period: active, overlapping it, the place-specific one before the all-places one. */
export function pickDeal<T extends { campusId: string | null; validFrom: Date; validTo: Date | null; isActive: boolean }>(deals: T[], campusId: string | null, from: Date, to: Date): T | null {
  const ok = deals.filter((d) => d.isActive && d.validFrom <= to && (!d.validTo || d.validTo >= from) && (d.campusId === null || d.campusId === campusId))
  ok.sort((a, b) => Number(b.campusId !== null) - Number(a.campusId !== null) || b.validFrom.getTime() - a.validFrom.getTime())
  return ok[0] ?? null
}
