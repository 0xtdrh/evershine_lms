import { describe, expect, it } from 'vitest'
import { activeConsequences, periodKey, resolveFee, type FeeRuleLite, type FeeTypeLite } from '@/lib/fees-extra/rules'

const platform: FeeTypeLite = { amount: 100, frequency: 'MONTHLY', defaultMode: 'REQUIRED', onUnpaid: 'LOCK_LMS' }

describe('extra fees + platform fee (FIN-2)', () => {
  it('required for everyone except a branch / a student; the most specific rule wins', () => {
    const rules: FeeRuleLite[] = [
      { scopeType: 'CAMPUS', scopeId: 'partner-school', mode: 'EXEMPT', amount: null, frequency: null, onUnpaid: null },
      { scopeType: 'STUDENT', scopeId: 's-vip', mode: 'REQUIRED', amount: 50, frequency: null, onUnpaid: 'REMIND' },
      { scopeType: 'LEVEL', scopeId: 'kids-1', mode: 'REQUIRED', amount: null, frequency: 'PER_LEVEL', onUnpaid: null },
    ]
    expect(resolveFee(platform, rules, { CAMPUS: 'kawther' })).toMatchObject({ mode: 'REQUIRED', amount: 100, from: 'DEFAULT' })
    expect(resolveFee(platform, rules, { CAMPUS: 'partner-school' })).toMatchObject({ mode: 'EXEMPT', from: 'CAMPUS' })
    // the student rule beats the place exemption
    expect(resolveFee(platform, rules, { CAMPUS: 'partner-school', STUDENT: 's-vip' })).toMatchObject({ mode: 'REQUIRED', amount: 50, onUnpaid: 'REMIND', from: 'STUDENT' })
    // a level rule changes only what it sets (frequency), the rest comes from the fee
    expect(resolveFee(platform, rules, { LEVEL: 'kids-1', CAMPUS: 'kawther' })).toMatchObject({ mode: 'REQUIRED', amount: 100, frequency: 'PER_LEVEL', onUnpaid: 'LOCK_LMS', from: 'LEVEL' })
  })
  it('periods stop double charging', () => {
    const d = new Date(Date.UTC(2026, 9, 17))
    expect(periodKey('MONTHLY', { date: d })).toBe('2026-10')
    expect(periodKey('PER_LEVEL', { date: d, levelId: 'L1' })).toBe('L:L1')
    expect(periodKey('YEARLY', { date: d })).toBe('Y:2026')
    expect(periodKey('ONCE', { date: d })).toBe('ONCE')
    expect(periodKey('MANUAL', { date: d })).toBeNull()
  })
  it('consequences only for unpaid charges past their due date', () => {
    const past = '2026-10-01'
    const future = '2099-01-01'
    const c = (onUnpaid: string, status: string, dueDate: string, paid = 0) => ({ onUnpaid, invoice: { status, dueDate, totalAmount: 100, paidAmount: paid } })
    const now = new Date('2026-10-17T00:00:00Z')
    expect([...activeConsequences([c('LOCK_LMS', 'ISSUED', past), c('BLOCK_NEXT', 'ISSUED', future), c('COUNT_WARNING', 'PAID', past, 100)], now)]).toEqual(['LOCK_LMS'])
  })
})
