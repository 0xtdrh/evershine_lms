import { describe, expect, it } from 'vitest'
import { computeTransferMoney, discountOptions } from '@/lib/groups/transfer-calc'

const base = { totalAmount: 800, paidAmount: 800, refundedAmount: 0, sessionsInCycle: 8, sessionsCounted: 2 }

describe('transfer money', () => {
  it('fully paid: counted sessions stay, the rest is credit', () => {
    const m = computeTransferMoney(base)
    expect(m).toMatchObject({ perSession: 100, consumed: 200, netPaid: 800, credit: 600, owed: 0, newTotal: 800, cancelled: 0 })
  })
  it('nothing attended: everything paid comes back', () => {
    expect(computeTransferMoney({ ...base, sessionsCounted: 0 })).toMatchObject({ consumed: 0, credit: 800, owed: 0 })
  })
  it('partly paid, more than used: credit + unpaid rest cancelled', () => {
    const m = computeTransferMoney({ ...base, paidAmount: 300 })
    expect(m).toMatchObject({ consumed: 200, credit: 100, owed: 0, newTotal: 300, cancelled: 500 })
  })
  it('partly paid, less than used: only the counted sessions stay due', () => {
    const m = computeTransferMoney({ ...base, paidAmount: 100, sessionsCounted: 3 })
    expect(m).toMatchObject({ consumed: 300, credit: 0, owed: 200, newTotal: 300, cancelled: 500 })
  })
  it('nothing paid, nothing attended: the whole invoice is cancelled', () => {
    expect(computeTransferMoney({ ...base, paidAmount: 0, sessionsCounted: 0 })).toMatchObject({ credit: 0, owed: 0, newTotal: 0, cancelled: 800 })
  })
  it('a refund given earlier is taken into account', () => {
    const m = computeTransferMoney({ ...base, refundedAmount: 100 })
    expect(m).toMatchObject({ netPaid: 700, credit: 500, owed: 0, newTotal: 800 })
  })
  it('whole cycle used: no credit, no rounding left-over', () => {
    expect(computeTransferMoney({ ...base, totalAmount: 1000, paidAmount: 1000, sessionsInCycle: 3, sessionsCounted: 3 })).toMatchObject({ consumed: 1000, credit: 0 })
    expect(computeTransferMoney({ ...base, sessionsCounted: 12 })).toMatchObject({ consumed: 800, credit: 0 })
  })
  it('price per session uses the invoice after discount', () => {
    expect(computeTransferMoney({ ...base, totalAmount: 600, paidAmount: 600 })).toMatchObject({ perSession: 75, consumed: 150, credit: 450 })
  })
})

describe('transfer discount suggestions', () => {
  const t = { fromClassSectionId: 'g1', toTrackId: 'tr1', typeFitsNewGroup: true }
  it('discount on the student in the old group moves with them', () => {
    expect(discountOptions({ studentId: 's', classSectionId: 'g1', trackId: null }, t)).toEqual({ options: ['MOVE', 'END'], suggested: 'MOVE' })
  })
  it('… unless its type does not fit the new group', () => {
    expect(discountOptions({ studentId: 's', classSectionId: 'g1', trackId: null }, { ...t, typeFitsNewGroup: false })?.suggested).toBe('END')
  })
  it('track discount: keep in the same track, end otherwise', () => {
    expect(discountOptions({ studentId: 's', classSectionId: null, trackId: 'tr1' }, t)?.suggested).toBe('KEEP')
    expect(discountOptions({ studentId: 's', classSectionId: null, trackId: 'tr2' }, t)?.suggested).toBe('END')
  })
  it('student-wide discount is kept', () => {
    expect(discountOptions({ studentId: 's', classSectionId: null, trackId: null }, { ...t, typeFitsNewGroup: false })).toEqual({ options: ['KEEP', 'END'], suggested: 'KEEP' })
  })
  it('whole-group and other groups’ discounts are not touched', () => {
    expect(discountOptions({ studentId: null, classSectionId: 'g1', trackId: null }, t)).toBeNull()
    expect(discountOptions({ studentId: 's', classSectionId: 'g9', trackId: null }, t)).toBeNull()
  })
})
