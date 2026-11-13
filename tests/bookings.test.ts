import { describe, expect, it } from 'vitest'
import { bookSchema, codeFitsTarget, holdExpired, invoicePaid, resolveRule, ruleSchema } from '@/lib/bookings/rules'
import { checkCode } from '@/lib/site/codes'

describe('booking confirm rules', () => {
  const rules = [
    { scopeType: 'COMPANY', scopeId: null, confirm: 'AUTO', holdHours: 24 },
    { scopeType: 'CAMPUS', scopeId: 'B1', confirm: 'STAFF', holdHours: null },
    { scopeType: 'GROUP', scopeId: 'G1', confirm: 'AUTO', holdHours: null },
  ]
  it('no rule = automatic, 48 hours', () => expect(resolveRule([], {})).toEqual({ confirm: 'AUTO', holdHours: 48 }))
  it('the most specific wins; the hold comes from the most specific rule that sets one', () => {
    expect(resolveRule(rules, { campusId: 'B2' })).toEqual({ confirm: 'AUTO', holdHours: 24 })
    expect(resolveRule(rules, { campusId: 'B1' })).toEqual({ confirm: 'STAFF', holdHours: 24 })
    expect(resolveRule(rules, { campusId: 'B1', groupId: 'G1' })).toEqual({ confirm: 'AUTO', holdHours: 24 })
  })
  it('a rule needs its target (company has none)', () => {
    expect(ruleSchema.safeParse({ scopeType: 'COMPANY', confirm: 'AUTO' }).success).toBe(true)
    expect(ruleSchema.safeParse({ scopeType: 'TRACK', confirm: 'STAFF' }).success).toBe(false)
    expect(ruleSchema.safeParse({ scopeType: 'COMPANY', scopeId: 'x', confirm: 'AUTO' }).success).toBe(false)
  })
})

describe('paid / expired', () => {
  const now = new Date('2026-11-13T12:00:00Z')
  it('paid = fully paid, nothing to pay, or part paid where instalments are allowed', () => {
    expect(invoicePaid({ totalAmount: 800, paidAmount: 800, status: 'PAID' })).toBe(true)
    expect(invoicePaid({ totalAmount: 0, paidAmount: 0, status: 'ISSUED' })).toBe(true)
    expect(invoicePaid({ totalAmount: 800, paidAmount: 300, status: 'PARTIALLY_PAID' })).toBe(false)
    expect(invoicePaid({ totalAmount: 800, paidAmount: 300, status: 'PARTIALLY_PAID' }, true)).toBe(true)
    expect(invoicePaid({ totalAmount: 800, paidAmount: 800, status: 'CANCELLED' })).toBe(false)
    expect(invoicePaid(null)).toBe(false)
  })
  it('a hold ends only when past, nothing paid and no receipt waiting', () => {
    const inv = { totalAmount: 800, paidAmount: 0, status: 'ISSUED' }
    expect(holdExpired('2026-11-13T13:00:00Z', inv, now)).toBe(false)
    expect(holdExpired('2026-11-13T11:00:00Z', inv, now)).toBe(true)
    expect(holdExpired('2026-11-13T11:00:00Z', { ...inv, proofStatus: 'PENDING' }, now)).toBe(false)
    expect(holdExpired('2026-11-13T11:00:00Z', { ...inv, paidAmount: 100 }, now)).toBe(false)
    expect(holdExpired(null, inv, now)).toBe(false)
  })
  it('a booking needs agreement', () => {
    expect(bookSchema.safeParse({ person: 'm:abc', slug: 'robots', mode: 'ONLINE', agree: true }).success).toBe(true)
    expect(bookSchema.safeParse({ person: 'm:abc', slug: 'robots', mode: 'ONLINE', agree: false }).success).toBe(false)
  })
})

describe('codes for a track / course / level / group', () => {
  const t = { listing: 'robots', trackId: 'T1', courseIds: ['C1', 'C2'], levelId: 'L1', groupId: 'G1' }
  it('matches its target', () => {
    expect(codeFitsTarget('TRACK', ['T1'], t)).toBe(true)
    expect(codeFitsTarget('COURSE', ['C2'], t)).toBe(true)
    expect(codeFitsTarget('LEVEL', ['L2'], t)).toBe(false)
    expect(codeFitsTarget('GROUP', ['G1'], t)).toBe(true)
    expect(codeFitsTarget('GROUP', ['G1'], { ...t, groupId: null })).toBe(false)
    expect(codeFitsTarget('LISTING', ['robots'], t)).toBe(true)
  })
  it('checkCode uses the target', () => {
    const c = { isActive: true, expiresAt: null, maxUses: 5, uses: 0, scope: 'TRACK', scopeIds: ['T9'] }
    expect(checkCode(c, { listing: 'robots', today: '2026-11-13', usedByPhone: false, target: t }).problem).toBe('NOT_THIS_COURSE')
    expect(checkCode({ ...c, scopeIds: ['T1'] }, { listing: 'robots', today: '2026-11-13', usedByPhone: false, target: t }).ok).toBe(true)
  })
})

import { computeDiscounts } from '@/lib/discounts/calculate'
describe('a free / prepaid code is not cut by the maximum discount', () => {
  it('covers the whole price even with a 50% cap; other discounts stay capped', () => {
    const free = { discountTypeId: 'F', label: 'Prepaid', valueType: 'PERCENT' as const, value: 100, stackable: true, ignoresCap: true }
    const sib = { discountTypeId: 'S', label: 'Sibling', valueType: 'PERCENT' as const, value: 80, stackable: true }
    expect(computeDiscounts(850, [free, sib], { allowStacking: true, maxTotalPercent: 50 }).total).toBe(850)
    expect(computeDiscounts(850, [sib], { allowStacking: true, maxTotalPercent: 50 }).total).toBe(425)
  })
})
