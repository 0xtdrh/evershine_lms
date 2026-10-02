/**
 * Pure discount maths (no database) — easy to test every scenario.
 * See docs/design-discounts.md.
 *
 * Rules:
 *  - every discount is computed on the invoice's BASE price (never discount on
 *    discount); a single discount can never exceed the base
 *  - stacking OFF (settings): only the best single discount applies
 *  - stacking ON: the stackable ones are added together; a non-stackable
 *    discount can only apply alone. Whichever option gives the student more wins
 *  - optional cap (settings): the total never goes above maxTotalPercent of the
 *    base; the biggest discounts are kept first
 *  - the total never exceeds the base (invoice never below zero)
 */

export type DiscountValueType = 'PERCENT' | 'FIXED'

export interface DiscountCandidate {
  discountTypeId: string
  assignmentId?: string | null
  label: string
  valueType: DiscountValueType
  value: number
  stackable: boolean
}

export interface DiscountRules {
  allowStacking: boolean
  /** null = no cap */
  maxTotalPercent: number | null
}

export interface DiscountLine extends DiscountCandidate {
  amount: number
}

export interface DiscountResult {
  lines: DiscountLine[]
  total: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function amountOf(base: number, c: Pick<DiscountCandidate, 'valueType' | 'value'>): number {
  if (!(base > 0) || !(c.value > 0)) return 0
  const raw = c.valueType === 'PERCENT' ? (base * Math.min(c.value, 100)) / 100 : c.value
  return round2(Math.min(raw, base))
}

const sum = (lines: DiscountLine[]) => round2(lines.reduce((s, l) => s + l.amount, 0))
const byAmountDesc = (a: DiscountLine, b: DiscountLine) => b.amount - a.amount

export function computeDiscounts(base: number, candidates: DiscountCandidate[], rules: DiscountRules): DiscountResult {
  const lines = candidates
    .map((c) => ({ ...c, amount: amountOf(base, c) }))
    .filter((l) => l.amount > 0)
    .sort(byAmountDesc)
  if (lines.length === 0) return { lines: [], total: 0 }

  let chosen: DiscountLine[]
  if (!rules.allowStacking) {
    chosen = [lines[0]]
  } else {
    const stackables = lines.filter((l) => l.stackable)
    const bestAlone = lines.filter((l) => !l.stackable)[0]
    chosen = bestAlone && bestAlone.amount > sum(stackables) ? [bestAlone] : stackables
    if (chosen.length === 0) chosen = [lines[0]]
  }

  // Cap: never more than maxTotalPercent of the base, and never more than the base.
  const capPercent = rules.maxTotalPercent == null ? 100 : Math.max(0, Math.min(100, rules.maxTotalPercent))
  let remaining = round2((base * capPercent) / 100)
  const capped: DiscountLine[] = []
  for (const l of chosen) {
    if (remaining <= 0) break
    const amount = round2(Math.min(l.amount, remaining))
    capped.push({ ...l, amount })
    remaining = round2(remaining - amount)
  }
  return { lines: capped, total: sum(capped) }
}

/** Teacher % pay: what the student paid, valued at the price BEFORE discounts (the company bears discounts). */
export function preDiscountCollected(inv: { paidAmount: number; subtotal: number; totalAmount: number; status?: string }): number {
  const paid = Math.max(0, inv.paidAmount)
  if (inv.totalAmount <= 0) return inv.status === 'CANCELLED' ? 0 : round2(Math.max(0, inv.subtotal)) // 100% discount = fully "paid"
  if (inv.subtotal <= inv.totalAmount) return round2(paid)
  return round2(Math.min(inv.subtotal, (paid * inv.subtotal) / inv.totalAmount))
}
