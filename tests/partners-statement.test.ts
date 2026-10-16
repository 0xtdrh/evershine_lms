import { describe, expect, it } from 'vitest'
import { overlaps, paymentProblem, periodBalance, remaining, signedPaid, statusAfterPayments } from '@/lib/partners/statement'

describe('partner statements (part 1-B)', () => {
  it('manual lines move the period balance the right way', () => {
    expect(periodBalance(-6000, [{ label: 'Agreed discount', amount: 500, payer: 'TECHNOVA' }])).toBe(-6500)
    expect(periodBalance(1200, [{ label: 'Kits', amount: 300, payer: 'PARTNER' }])).toBe(1500)
  })
  it('payments both ways, rest and status', () => {
    expect(signedPaid([{ direction: 'PARTNER_TO_TECHNOVA', amount: 1000 }, { direction: 'TECHNOVA_TO_PARTNER', amount: 200 }])).toBe(800)
    expect(remaining(1500, [{ direction: 'PARTNER_TO_TECHNOVA', amount: 1000 }])).toBe(500)
    expect(statusAfterPayments(1500, [])).toBe('APPROVED')
    expect(statusAfterPayments(1500, [{ direction: 'PARTNER_TO_TECHNOVA', amount: 1000 }])).toBe('PARTIAL')
    expect(statusAfterPayments(-6000, [{ direction: 'TECHNOVA_TO_PARTNER', amount: 6000 }])).toBe('PAID')
    expect(statusAfterPayments(0, [])).toBe('PAID')
  })
  it('a payment must go the right way and not pass the rest', () => {
    expect(paymentProblem(1500, [], { direction: 'TECHNOVA_TO_PARTNER', amount: 100 })).toMatch(/partner owes/)
    expect(paymentProblem(-6000, [], { direction: 'PARTNER_TO_TECHNOVA', amount: 100 })).toMatch(/TechNova owes/)
    expect(paymentProblem(1500, [{ direction: 'PARTNER_TO_TECHNOVA', amount: 1000 }], { direction: 'PARTNER_TO_TECHNOVA', amount: 600 })).toMatch(/More than/)
    expect(paymentProblem(1500, [], { direction: 'PARTNER_TO_TECHNOVA', amount: 1500 })).toBeNull()
    expect(paymentProblem(0, [], { direction: 'PARTNER_TO_TECHNOVA', amount: 1 })).toMatch(/Nothing/)
  })
  it('periods overlap', () => {
    expect(overlaps({ from: new Date('2026-10-01'), to: new Date('2026-10-31') }, { from: new Date('2026-10-31'), to: new Date('2026-11-30') })).toBe(true)
    expect(overlaps({ from: new Date('2026-10-01'), to: new Date('2026-10-31') }, { from: new Date('2026-11-01'), to: new Date('2026-11-30') })).toBe(false)
  })
})
