import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, paidEnough, policySchema, resolvePolicy, type PolicyRow } from '@/lib/groups/policy'

const row = (over: Partial<PolicyRow>): PolicyRow => ({ scopeType: 'COMPANY', scopeId: null, entry: null, minStudents: null, countPaidOnly: null, minPartPercent: null, alertDays: null, nextMonthKeepDays: null, startAnyway: null, ...over })

describe('group policy', () => {
  it('no rule = joins at once, no minimum', () => expect(resolvePolicy([], {})).toEqual(DEFAULT_POLICY))
  it('field by field: the most specific row that sets a field wins', () => {
    const rows = [
      row({ entry: 'AFTER_PAYMENT', minStudents: 6, alertDays: 4, startAnyway: true }),
      row({ scopeType: 'CAMPUS', scopeId: 'B1', minStudents: 4 }),
      row({ scopeType: 'GROUP', scopeId: 'G1', minStudents: 3, entry: 'NOW' }),
    ]
    const b1 = resolvePolicy(rows, { campusId: 'B1' })
    expect([b1.entry, b1.minStudents, b1.alertDays, b1.countPaidOnly, b1.startAnyway]).toEqual(['AFTER_PAYMENT', 4, 4, true, true])
    const g1 = resolvePolicy(rows, { campusId: 'B1', groupId: 'G1' })
    expect([g1.entry, g1.minStudents, g1.countPaidOnly]).toEqual(['NOW', 3, false])
  })
  it("the group's 'full payment before the start' switch means after payment", () => {
    expect(resolvePolicy([], {}, { requireFullPaymentToStart: true }).entry).toBe('AFTER_PAYMENT')
  })
  it('paid enough: full, free, or the minimum part where instalments are allowed', () => {
    const inv = (paid: number) => ({ totalAmount: 800, paidAmount: paid, status: paid ? 'PARTIALLY_PAID' : 'ISSUED' })
    expect(paidEnough(inv(800), false, null)).toBe(true)
    expect(paidEnough({ totalAmount: 0, paidAmount: 0, status: 'ISSUED' }, false, null)).toBe(true)
    expect(paidEnough(inv(200), false, null)).toBe(false)
    expect(paidEnough(inv(200), true, null)).toBe(true)
    expect(paidEnough(inv(200), true, 50)).toBe(false)
    expect(paidEnough(inv(400), true, 50)).toBe(true)
    expect(paidEnough(inv(0), true, null)).toBe(false)
    expect(paidEnough(null, true, null)).toBe(false)
  })
  it('a rule needs its target', () => {
    expect(policySchema.safeParse({ scopeType: 'COMPANY', entry: 'AFTER_PAYMENT' }).success).toBe(true)
    expect(policySchema.safeParse({ scopeType: 'GROUP', minStudents: 4 }).success).toBe(false)
  })
})
