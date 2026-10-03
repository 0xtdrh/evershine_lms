import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { paymobFee, withdrawFee } from '@/lib/wallet/engine'

describe('wallet fees (phase B)', () => {
  it('Paymob fee = percent of the amount + fixed, paid on top', () => {
    expect(paymobFee(850, { paymobFeePercent: 2.5, paymobFeeFixed: 3 })).toBe(24.25)
    expect(paymobFee(850, { paymobFeePercent: 0, paymobFeeFixed: 0 })).toBe(0)
    expect(paymobFee(0, { paymobFeePercent: 2.5, paymobFeeFixed: 3 })).toBe(0)
  })
  it('withdrawal fee depends on how the money goes back', () => {
    const s = { withdrawFees: { Cash: { type: 'FIXED' as const, value: 0 }, InstaPay: { type: 'PERCENT' as const, value: 1 }, 'Bank Transfer': { type: 'FIXED' as const, value: 25 } } }
    expect(withdrawFee(500, 'Cash', s)).toBe(0)
    expect(withdrawFee(500, 'InstaPay', s)).toBe(5)
    expect(withdrawFee(500, 'Bank Transfer', s)).toBe(25)
    expect(withdrawFee(500, 'Vodafone Cash', s)).toBe(0)
  })
  it('a fee is never more than the amount', () => {
    expect(withdrawFee(10, 'Bank Transfer', { withdrawFees: { 'Bank Transfer': { type: 'FIXED', value: 25 } } })).toBe(10)
  })
})
