/**
 * Instructor pay statement — pure maths (2026-10-26, owner). One calendar month, for one instructor, over one group,
 * one place or all his groups. Same pay rules as lib/groups/teacher-pay.ts, counted by MONTH instead of by cycle:
 *  - per session: each session he taught in the month (attendance he recorded / was credited with) × the group rate;
 *  - percent: his % of what was actually paid in the month on the group's invoices, valued BEFORE discounts
 *    (the company bears discounts) minus refunds approved in the month — shown per student as HIS SHARE only
 *    (owner: never show what the student paid);
 *  - fixed: once per group (each billing month is its own group), in the month the group started;
 *  - bonuses / deductions: manual ones by the day they were recorded, substitute ones by the session day.
 * Tests: tests/pay-statement.test.ts.
 */

export const round2 = (n: number) => Math.round(n * 100) / 100

export interface PayRule { fixed: number | null; percent: number | null; perSession: number | null }

export interface StatementSession {
  date: string            // YYYY-MM-DD
  n: number | null        // session number in the group
  of: number | null       // sessions in the group's month
  counted: boolean        // taught by this instructor AND paid by TechNova that day
  /** who taught it when it was not this instructor (substitute) — shown, not paid */
  otherTeacher?: string | null
  /** not paid: the instructor was a trainee / employed by a partner that day */
  notPaidByTechNova?: boolean
}

export interface StatementStudentShare { student: string; preDiscountPaid: number }

export interface StatementAdjustment { amount: number; reason: string; date: string; kind: 'MANUAL' | 'SUBSTITUTE' }

export interface StatementGroupFacts {
  id: string
  label: string
  place: string
  campusId?: string
  /** true when the instructor is not this group's own instructor (he covered sessions as a substitute) */
  coveredOnly?: boolean
  rule: PayRule
  fixedCounts: boolean    // the group started in this month and TechNova paid him then
  sessions: StatementSession[]
  students: StatementStudentShare[]
  adjustments: StatementAdjustment[]
}

export interface StatementGroup extends StatementGroupFacts {
  sessionsCounted: number
  sessionAmount: number
  percentAmount: number
  studentShares: { student: string; share: number }[]
  fixedAmount: number
  bonuses: number
  deductions: number
  total: number
  /** what kind of pay this group has — "mixed" when several parts apply */
  payKind: 'PER_SESSION' | 'PERCENT' | 'FIXED' | 'MIXED' | 'NONE'
}

export interface StatementTotals { sessions: number; sessionAmount: number; percentAmount: number; fixedAmount: number; earnings: number; bonuses: number; deductions: number; net: number }

export function payKind(rule: PayRule): StatementGroup['payKind'] {
  const parts = [rule.perSession, rule.percent, rule.fixed].filter((x) => x != null && Number(x) > 0).length
  if (parts > 1) return 'MIXED'
  if (rule.perSession) return 'PER_SESSION'
  if (rule.percent) return 'PERCENT'
  if (rule.fixed) return 'FIXED'
  return 'NONE'
}

export function statementGroup(g: StatementGroupFacts): StatementGroup {
  const sessionsCounted = g.coveredOnly ? 0 : g.sessions.filter((s) => s.counted).length
  const sessionAmount = round2(sessionsCounted * (g.rule.perSession ?? 0))
  const pct = g.coveredOnly ? 0 : (g.rule.percent ?? 0)
  const studentShares = pct
    ? g.students.map((s) => ({ student: s.student, share: round2(Math.max(0, s.preDiscountPaid) * pct / 100) })).filter((s) => s.share !== 0)
    : []
  const percentAmount = round2(studentShares.reduce((a, s) => a + s.share, 0))
  const fixedAmount = !g.coveredOnly && g.fixedCounts ? round2(g.rule.fixed ?? 0) : 0
  const bonuses = round2(g.adjustments.filter((a) => a.amount > 0).reduce((a, x) => a + x.amount, 0))
  const deductions = round2(-g.adjustments.filter((a) => a.amount < 0).reduce((a, x) => a + x.amount, 0))
  const total = round2(sessionAmount + percentAmount + fixedAmount + bonuses - deductions)
  return { ...g, sessionsCounted, sessionAmount, percentAmount, studentShares, fixedAmount, bonuses, deductions, total, payKind: g.coveredOnly ? 'NONE' : payKind(g.rule) }
}

export function statementTotals(groups: StatementGroup[], general: StatementAdjustment[] = []): StatementTotals {
  const sum = (f: (g: StatementGroup) => number) => round2(groups.reduce((a, g) => a + f(g), 0))
  const sessionAmount = sum((g) => g.sessionAmount)
  const percentAmount = sum((g) => g.percentAmount)
  const fixedAmount = sum((g) => g.fixedAmount)
  const bonuses = round2(sum((g) => g.bonuses) + general.filter((a) => a.amount > 0).reduce((a, x) => a + x.amount, 0))
  const deductions = round2(sum((g) => g.deductions) - general.filter((a) => a.amount < 0).reduce((a, x) => a + x.amount, 0))
  const earnings = round2(sessionAmount + percentAmount + fixedAmount)
  return { sessions: groups.reduce((a, g) => a + g.sessionsCounted, 0), sessionAmount, percentAmount, fixedAmount, earnings, bonuses, deductions, net: round2(earnings + bonuses - deductions) }
}

/** Value of a payment before the invoice's discount (same idea as preDiscountCollected, for one amount). */
export function preDiscountValue(amount: number, subtotal: number, totalAmount: number): number {
  if (totalAmount <= 0 || subtotal <= totalAmount) return round2(amount)
  return round2((amount * subtotal) / totalAmount)
}

/** Calendar month "YYYY-MM" → [first day, first day of next month) in UTC dates. */
export function monthBounds(month: string): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]) - 1
  if (mo < 0 || mo > 11) return null
  return { from: new Date(Date.UTC(y, mo, 1)), to: new Date(Date.UTC(y, mo + 1, 1)) }
}

/** Salary-slip lines from a statement: one earning line per group (+ its bonuses / deductions) and the general ones. */
export function slipLinesFromStatement(groups: StatementGroup[], general: StatementAdjustment[] = []) {
  const lines: { label: string; value: number; isDeduction: boolean }[] = []
  for (const g of groups) {
    const earned = round2(g.sessionAmount + g.percentAmount + g.fixedAmount)
    if (earned) lines.push({ label: g.label, value: earned, isDeduction: false })
    for (const a of g.adjustments) lines.push({ label: `${g.label} — ${a.reason}`.slice(0, 120), value: Math.abs(a.amount), isDeduction: a.amount < 0 })
  }
  for (const a of general) lines.push({ label: a.reason.slice(0, 120), value: Math.abs(a.amount), isDeduction: a.amount < 0 })
  return lines
}
