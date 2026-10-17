import { describe, expect, it } from 'vitest'
import { balanceOf, countOutcome, pickAccount, type Route } from '@/lib/treasury/rules'

const routes: Route[] = [
  { method: 'Cash', campusId: null, accountId: 'main-box' },
  { method: 'Cash', campusId: 'kawther', accountId: 'kawther-box' },
  { method: 'InstaPay', campusId: null, accountId: 'instapay' },
]

describe('money accounts (FIN-1)', () => {
  it('a branch route wins over the every-branch one; no route = not placed', () => {
    expect(pickAccount(routes, 'cash', 'kawther')).toBe('kawther-box')
    expect(pickAccount(routes, 'Cash', 'dahar')).toBe('main-box')
    expect(pickAccount(routes, 'InstaPay', 'kawther')).toBe('instapay')
    expect(pickAccount(routes, 'Vodafone Cash', 'kawther')).toBeNull()
    expect(pickAccount(routes, null, 'kawther')).toBeNull()
  })
  it('balance = opening + in − out, from the opening date on', () => {
    const mv = [
      { direction: 'IN', amount: 850, date: '2026-10-01' },
      { direction: 'OUT', amount: 200, date: '2026-10-02' },
      { direction: 'IN', amount: 999, date: '2026-09-01' }, // before the opening date: already inside the opening balance
    ]
    expect(balanceOf(1000, '2026-09-30', mv)).toBe(1650)
    expect(balanceOf(1000, '2026-09-30', mv, new Date('2026-10-01T12:00:00Z'))).toBe(1850)
  })
  it('end-of-day count: difference and automatic approval inside the tolerance', () => {
    expect(countOutcome(4250, 4250, 0)).toEqual({ difference: 0, autoApprove: true })
    expect(countOutcome(4250, 4240, 20)).toEqual({ difference: -10, autoApprove: true })
    expect(countOutcome(4250, 4100, 20)).toEqual({ difference: -150, autoApprove: false })
  })
})
