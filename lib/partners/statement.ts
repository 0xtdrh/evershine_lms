/**
 * Partners part 1-B — statement maths (pure, tested in tests/partners-statement.test.ts).
 * Every amount is from TechNova's side: positive = the partner owes TechNova, negative = TechNova owes the partner.
 */

export interface ManualLine { label: string; amount: number; payer: 'TECHNOVA' | 'PARTNER'; reason?: string | null }
export interface StatementPayment { direction: 'PARTNER_TO_TECHNOVA' | 'TECHNOVA_TO_PARTNER'; amount: number }

const r2 = (n: number) => Math.round(n * 100) / 100

/** The period balance: the deal result plus manual lines (a line the partner pays raises it, one TechNova pays lowers it). */
export function periodBalance(dealBalance: number, manual: ManualLine[]): number {
  return r2(dealBalance + manual.reduce((s, l) => s + (l.payer === 'PARTNER' ? Number(l.amount) : -Number(l.amount)), 0))
}

/** Money moved so far, from TechNova's side (received − paid out). */
export function signedPaid(payments: StatementPayment[]): number {
  return r2(payments.reduce((s, p) => s + (p.direction === 'PARTNER_TO_TECHNOVA' ? Number(p.amount) : -Number(p.amount)), 0))
}

export const remaining = (totalDue: number, payments: StatementPayment[]) => r2(totalDue - signedPaid(payments))

/** Status of an approved statement after its payments. */
export function statusAfterPayments(totalDue: number, payments: StatementPayment[]): 'APPROVED' | 'PARTIAL' | 'PAID' {
  if (Math.abs(remaining(totalDue, payments)) < 0.01) return 'PAID'
  return payments.length ? 'PARTIAL' : 'APPROVED'
}

/** A payment must go the way the money is owed and not pass the rest. null = fine. */
export function paymentProblem(totalDue: number, payments: StatementPayment[], p: StatementPayment): string | null {
  if (!(Number(p.amount) > 0)) return 'The amount must be more than zero'
  const rest = remaining(totalDue, payments)
  if (Math.abs(rest) < 0.01) return 'Nothing is left to pay on this statement'
  if (rest > 0 && p.direction !== 'PARTNER_TO_TECHNOVA') return 'On this statement the partner owes TechNova'
  if (rest < 0 && p.direction !== 'TECHNOVA_TO_PARTNER') return 'On this statement TechNova owes the partner'
  if (Number(p.amount) - Math.abs(rest) > 0.009) return `More than what is left (${Math.abs(rest)})`
  return null
}

/** Two periods overlap. */
export const overlaps = (a: { from: Date; to: Date }, b: { from: Date; to: Date }) => a.from <= b.to && b.from <= a.to
