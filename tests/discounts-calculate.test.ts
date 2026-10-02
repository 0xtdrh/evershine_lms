import { describe, expect, it } from 'vitest'
import { amountOf, computeDiscounts, preDiscountCollected, type DiscountCandidate } from '@/lib/discounts/calculate'

const c = (id: string, valueType: 'PERCENT' | 'FIXED', value: number, stackable = true): DiscountCandidate => ({
  discountTypeId: id, label: id, valueType, value, stackable,
})
const STACK = { allowStacking: true, maxTotalPercent: null }
const NO_STACK = { allowStacking: false, maxTotalPercent: null }

describe('amountOf', () => {
  it('percent of the base', () => expect(amountOf(850, { valueType: 'PERCENT', value: 10 })).toBe(85))
  it('fixed amount', () => expect(amountOf(850, { valueType: 'FIXED', value: 100 })).toBe(100))
  it('never more than the base', () => {
    expect(amountOf(850, { valueType: 'FIXED', value: 1000 })).toBe(850)
    expect(amountOf(850, { valueType: 'PERCENT', value: 150 })).toBe(850)
  })
  it('zero / negative values give nothing', () => {
    expect(amountOf(850, { valueType: 'FIXED', value: 0 })).toBe(0)
    expect(amountOf(0, { valueType: 'PERCENT', value: 10 })).toBe(0)
  })
})

describe('computeDiscounts', () => {
  it('no discounts', () => expect(computeDiscounts(850, [], STACK)).toEqual({ lines: [], total: 0 }))

  it('one discount', () => {
    const r = computeDiscounts(850, [c('sib', 'PERCENT', 10)], STACK)
    expect(r.total).toBe(85)
  })

  it('stacking ON: stackable discounts add up, each on the base price', () => {
    const r = computeDiscounts(850, [c('sib', 'PERCENT', 10), c('promo', 'FIXED', 100)], STACK)
    expect(r.total).toBe(185) // 85 + 100, not 10% of (850-100)
    expect(r.lines).toHaveLength(2)
  })

  it('stacking OFF in settings: only the best single discount', () => {
    const r = computeDiscounts(850, [c('sib', 'PERCENT', 10), c('promo', 'FIXED', 100)], NO_STACK)
    expect(r.lines.map((l) => l.discountTypeId)).toEqual(['promo'])
    expect(r.total).toBe(100)
  })

  it('a non-stackable discount applies alone when it is bigger than the stackable sum', () => {
    const r = computeDiscounts(850, [c('sib', 'PERCENT', 10), c('promo', 'FIXED', 50), c('vip', 'PERCENT', 30, false)], STACK)
    expect(r.lines.map((l) => l.discountTypeId)).toEqual(['vip'])
    expect(r.total).toBe(255)
  })

  it('stackables win when their sum beats the non-stackable one', () => {
    const r = computeDiscounts(850, [c('sib', 'PERCENT', 10), c('promo', 'FIXED', 200), c('small', 'FIXED', 100, false)], STACK)
    expect(r.lines.map((l) => l.discountTypeId).sort()).toEqual(['promo', 'sib'])
    expect(r.total).toBe(285)
  })

  it('two non-stackable discounts never combine (the best one applies)', () => {
    const r = computeDiscounts(850, [c('a', 'FIXED', 100, false), c('b', 'FIXED', 150, false)], STACK)
    expect(r.lines.map((l) => l.discountTypeId)).toEqual(['b'])
  })

  it('cap from settings limits the total (biggest discounts kept first)', () => {
    const r = computeDiscounts(1000, [c('a', 'PERCENT', 30), c('b', 'PERCENT', 30)], { allowStacking: true, maxTotalPercent: 50 })
    expect(r.total).toBe(500)
    expect(r.lines.map((l) => l.amount)).toEqual([300, 200])
  })

  it('cap also applies to a single discount', () => {
    const r = computeDiscounts(1000, [c('a', 'PERCENT', 80)], { allowStacking: false, maxTotalPercent: 50 })
    expect(r.total).toBe(500)
  })

  it('total never exceeds the base (invoice never below zero)', () => {
    const r = computeDiscounts(850, [c('a', 'FIXED', 600), c('b', 'FIXED', 600)], STACK)
    expect(r.total).toBe(850)
  })

  it('100% discount gives a zero invoice', () => {
    expect(computeDiscounts(850, [c('free', 'PERCENT', 100)], STACK).total).toBe(850)
  })

  it('rounds to piasters', () => {
    expect(computeDiscounts(850, [c('a', 'PERCENT', 33.33)], STACK).total).toBe(283.31)
  })
})

describe('preDiscountCollected (teacher % pay: the company bears discounts)', () => {
  it('no discount: what was paid', () => expect(preDiscountCollected({ paidAmount: 850, subtotal: 850, totalAmount: 850 })).toBe(850))
  it('fully paid with a discount counts the full price', () => expect(preDiscountCollected({ paidAmount: 750, subtotal: 850, totalAmount: 750 })).toBe(850))
  it('half paid counts half the full price', () => expect(preDiscountCollected({ paidAmount: 375, subtotal: 850, totalAmount: 750 })).toBe(425))
  it('nothing paid counts nothing', () => expect(preDiscountCollected({ paidAmount: 0, subtotal: 850, totalAmount: 750 })).toBe(0))
  it('100% discount counts the full price', () => expect(preDiscountCollected({ paidAmount: 0, subtotal: 850, totalAmount: 0, status: 'PAID' })).toBe(850))
  it('cancelled zero invoice counts nothing', () => expect(preDiscountCollected({ paidAmount: 0, subtotal: 850, totalAmount: 0, status: 'CANCELLED' })).toBe(0))
})
