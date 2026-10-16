import { describe, expect, it } from 'vitest'
import { computeDeal, dealProblem, periodMonths, pickDeal, type DealFacts } from '@/lib/partners/deal'

const facts = (x: Partial<DealFacts> = {}): DealFacts => ({ collected: 20000, refunds: 0, discounts: 0, sessionsHeld: 8, sessionsCancelledByPartner: 0, students: 15, groups: 2, months: 1, ...x })

describe('partner deals (part 1)', () => {
  it('Sheraton: TechNova collects, the centre takes 30% → TechNova pays 6,000', () => {
    const r = computeDeal({ collector: 'TECHNOVA', components: [{ kind: 'PERCENT', value: 30 }], countPartnerCancelled: true, period: 'MONTH' }, facts())
    expect(r.shareTotal).toBe(6000)
    expect(r.balanceForTechNova).toBe(-6000)
  })
  it('percentage on net (after refunds) or gross (before discounts)', () => {
    const d = { collector: 'TECHNOVA' as const, countPartnerCancelled: true, period: 'MONTH' as const }
    expect(computeDeal({ ...d, components: [{ kind: 'PERCENT', value: 10 }] }, facts({ refunds: 2000 })).shareTotal).toBe(1800)
    expect(computeDeal({ ...d, components: [{ kind: 'PERCENT', value: 10, base: 'GROSS' }] }, facts({ discounts: 1000 })).shareTotal).toBe(2100)
  })
  it('nursery pays 150 per session; partner-cancelled sessions count only if the deal says so', () => {
    const base = { collector: 'INSTITUTION' as const, components: [{ kind: 'PER_SESSION' as const, value: 150 }], period: 'MONTH' as const }
    expect(computeDeal({ ...base, countPartnerCancelled: true }, facts({ sessionsCancelledByPartner: 1 })).balanceForTechNova).toBe(1350)
    expect(computeDeal({ ...base, countPartnerCancelled: false }, facts({ sessionsCancelledByPartner: 1 })).balanceForTechNova).toBe(1200)
  })
  it('academy collects, TechNova takes 200 per student per month → the academy pays 3,000', () => {
    expect(computeDeal({ collector: 'PARTNER', components: [{ kind: 'PER_STUDENT_MONTH', value: 200 }], countPartnerCancelled: true, period: 'MONTH' }, facts()).balanceForTechNova).toBe(3000)
  })
  it('rent + percentage, with a guaranteed minimum and extras for each side', () => {
    const r = computeDeal({
      collector: 'TECHNOVA',
      components: [{ kind: 'FIXED_MONTHLY', value: 1500 }, { kind: 'PERCENT', value: 10 }, { kind: 'MINIMUM', value: 5000 }],
      extras: [{ label: 'Kits', amount: 300, per: 'ONCE', payer: 'PARTNER' }, { label: 'Transport', amount: 50, per: 'SESSION', payer: 'TECHNOVA' }],
      countPartnerCancelled: true, period: 'MONTH',
    }, facts())
    expect(r.shareTotal).toBe(5000) // 1500 + 2000 = 3500 → minimum 5000
    expect(r.balanceForTechNova).toBe(-5000 + 300 - 400)
  })
  it('per hour, per group, per term', () => {
    const d = { collector: 'INSTITUTION' as const, countPartnerCancelled: true, period: 'TERM' as const }
    expect(computeDeal({ ...d, components: [{ kind: 'PER_HOUR', value: 100, hoursPerSession: 1.5 }] }, facts()).shareTotal).toBe(1200)
    expect(computeDeal({ ...d, components: [{ kind: 'PER_GROUP_MONTH', value: 500 }] }, facts({ months: 3 })).shareTotal).toBe(3000)
    expect(computeDeal({ ...d, components: [{ kind: 'PER_TERM', value: 9000 }] }, facts({ months: 3 })).shareTotal).toBe(9000)
  })
  it('checks', () => {
    expect(dealProblem({ collector: 'INSTITUTION', components: [{ kind: 'PERCENT', value: 10 }], countPartnerCancelled: true, period: 'MONTH' })).toMatch(/percentage/)
    expect(dealProblem({ collector: 'TECHNOVA', components: [{ kind: 'PERCENT', value: 120 }], countPartnerCancelled: true, period: 'MONTH' })).toMatch(/100/)
    expect(dealProblem({ collector: 'TECHNOVA', components: [], countPartnerCancelled: true, period: 'MONTH' })).toMatch(/at least one/)
    expect(dealProblem({ collector: 'TECHNOVA', components: [{ kind: 'PERCENT', value: 30 }], countPartnerCancelled: true, period: 'MONTH' })).toBeNull()
  })
  it('period months and which deal applies', () => {
    expect(periodMonths(new Date('2026-10-01'), new Date('2026-10-31'))).toBe(1)
    expect(periodMonths(new Date('2026-09-01'), new Date('2026-11-30'))).toBe(3)
    const all = { campusId: null, validFrom: new Date('2026-01-01'), validTo: null, isActive: true, id: 'all' }
    const place = { campusId: 'A', validFrom: new Date('2026-09-01'), validTo: null, isActive: true, id: 'place' }
    expect(pickDeal([all, place], 'A', new Date('2026-10-01'), new Date('2026-10-31'))?.id).toBe('place')
    expect(pickDeal([all, place], 'B', new Date('2026-10-01'), new Date('2026-10-31'))?.id).toBe('all')
    expect(pickDeal([{ ...all, validTo: new Date('2026-06-30') }], 'B', new Date('2026-10-01'), new Date('2026-10-31'))).toBeNull()
  })
})
