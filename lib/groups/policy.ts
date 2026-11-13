/**
 * Six phases E (2026-11-13): how students enter a group and when a group may start (pure, tests/group-policy.test.ts).
 * Scopes add up like the booking rules: GROUP > LEVEL > COURSE > TRACK > CAMPUS > COMPANY, but field by field — the most
 * specific row that SETS a field wins (a group row may change only the minimum, the rest comes from above).
 * A group switched to "full payment before the start" (ClassSection.requireFullPaymentToStart) always enters after payment.
 */

import { z } from 'zod'

export const POLICY_SCOPES = ['COMPANY', 'CAMPUS', 'TRACK', 'COURSE', 'LEVEL', 'GROUP'] as const
export type PolicyScope = (typeof POLICY_SCOPES)[number]
const RANK: Record<PolicyScope, number> = { GROUP: 6, LEVEL: 5, COURSE: 4, TRACK: 3, CAMPUS: 2, COMPANY: 1 }

export interface PolicyRow {
  scopeType: string; scopeId: string | null
  entry: string | null; minStudents: number | null; countPaidOnly: boolean | null; minPartPercent: number | null
  alertDays: number | null; nextMonthKeepDays: number | null; startAnyway: boolean | null
}
export interface PolicyWhere { campusId?: string | null; trackId?: string | null; courseId?: string | null; levelId?: string | null; groupId?: string | null }

export interface Policy {
  entry: 'NOW' | 'AFTER_PAYMENT'
  minStudents: number | null
  countPaidOnly: boolean
  minPartPercent: number | null
  alertDays: number
  nextMonthKeepDays: number
  startAnyway: boolean
}
export const DEFAULT_POLICY: Policy = { entry: 'NOW', minStudents: null, countPaidOnly: false, minPartPercent: null, alertDays: 5, nextMonthKeepDays: 7, startAnyway: false }

export function resolvePolicy(rows: PolicyRow[], w: PolicyWhere, group?: { requireFullPaymentToStart?: boolean | null }): Policy {
  const id: Record<PolicyScope, string | null | undefined> = { COMPANY: null, CAMPUS: w.campusId, TRACK: w.trackId, COURSE: w.courseId, LEVEL: w.levelId, GROUP: w.groupId }
  const hits = rows
    .filter((r) => (POLICY_SCOPES as readonly string[]).includes(r.scopeType))
    .filter((r) => (r.scopeType === 'COMPANY' ? !r.scopeId : !!r.scopeId && r.scopeId === id[r.scopeType as PolicyScope]))
    .sort((a, b) => RANK[b.scopeType as PolicyScope] - RANK[a.scopeType as PolicyScope])
  const pick = <K extends keyof PolicyRow>(k: K) => hits.find((h) => h[k] !== null && h[k] !== undefined)?.[k] ?? null
  const entry = group?.requireFullPaymentToStart ? 'AFTER_PAYMENT' : pick('entry') === 'AFTER_PAYMENT' ? 'AFTER_PAYMENT' : 'NOW'
  const countPaidOnly = pick('countPaidOnly')
  return {
    entry,
    minStudents: (pick('minStudents') as number | null) ?? null,
    // "after payment" groups count only those who paid unless a rule says otherwise
    countPaidOnly: countPaidOnly === null ? entry === 'AFTER_PAYMENT' : !!countPaidOnly,
    minPartPercent: (pick('minPartPercent') as number | null) ?? null,
    alertDays: (pick('alertDays') as number | null) ?? DEFAULT_POLICY.alertDays,
    nextMonthKeepDays: (pick('nextMonthKeepDays') as number | null) ?? DEFAULT_POLICY.nextMonthKeepDays,
    startAnyway: !!pick('startAnyway'),
  }
}

/** Paid enough to enter / to count: fully paid, nothing to pay, or (instalments allowed) at least the minimum part (none set = any payment). */
export function paidEnough(inv: { totalAmount: number; paidAmount: number; status: string } | null, installmentsAllowed: boolean, minPartPercent: number | null): boolean {
  if (!inv || inv.status === 'CANCELLED') return false
  if (inv.totalAmount <= 0 || inv.status === 'PAID' || inv.paidAmount >= inv.totalAmount) return true
  if (!installmentsAllowed || inv.paidAmount <= 0) return false
  return minPartPercent == null ? true : inv.paidAmount + 0.005 >= (inv.totalAmount * minPartPercent) / 100
}

export const policySchema = z.object({
  scopeType: z.enum(POLICY_SCOPES),
  scopeId: z.string().max(40).nullable().optional(),
  entry: z.enum(['NOW', 'AFTER_PAYMENT']).nullable().optional(),
  minStudents: z.number().int().min(1).max(200).nullable().optional(),
  countPaidOnly: z.boolean().nullable().optional(),
  minPartPercent: z.number().int().min(1).max(100).nullable().optional(),
  alertDays: z.number().int().min(0).max(60).nullable().optional(),
  nextMonthKeepDays: z.number().int().min(0).max(60).nullable().optional(),
  startAnyway: z.boolean().nullable().optional(),
}).refine((r) => (r.scopeType === 'COMPANY') === !r.scopeId, { message: 'Choose what the rule is for · اختار القاعدة لإيه', path: ['scopeId'] })
export type PolicyInput = z.infer<typeof policySchema>
