import { describe, expect, it } from 'vitest'
import { buildSheet, sheetTotals } from '@/lib/treasury/daily-sheet-calc'

const mv = (id: string, direction: 'IN' | 'OUT', amount: number, kind: string, extra: Record<string, unknown> = {}) =>
  ({ id, direction, amount, date: `2026-10-30T0${id.length}:00:00Z`, kind, method: 'Cash', note: id, ...extra })

const count = (counted: number, status = 'APPROVED', difference = 0) => ({ id: 'c-today', counted, expected: counted - difference, difference, status, countedBy: 'Sara', countedAt: '2026-10-30T16:00:00Z', approvedBy: null, approvedAt: null, note: null })

describe('daily cash-close sheet (a04)', () => {
  it("opening = yesterday's approved count; the difference it posted is not counted again", () => {
    const s = buildSheet({
      computedOpening: 950, yesterdayCount: { id: 'c-y', counted: 1000 }, count: null,
      dayMovements: [mv('p1', 'IN', 300, 'PAYMENT'), mv('e1', 'OUT', 100, 'EXPENSE'), mv('adj', 'IN', 50, 'ADJUST', { cashCountId: 'c-y' })],
    })
    expect([s.opening, s.openingSource, s.totalIn, s.totalOut, s.expected, s.state, s.difference]).toEqual([1000, 'YESTERDAY_COUNT', 300, 100, 1200, 'NOT_COUNTED', null])
  })
  it('no count yesterday = the balance from the books', () => {
    const s = buildSheet({ computedOpening: 950, yesterdayCount: null, count: null, dayMovements: [mv('p1', 'IN', 50, 'PAYMENT')] })
    expect([s.opening, s.openingSource, s.expected]).toEqual([950, 'COMPUTED', 1000])
  })
  it("today's count: its own difference, money after the count apart; its own adjustment is left out", () => {
    const s = buildSheet({
      computedOpening: 500, yesterdayCount: null, count: count(680, 'APPROVED', -20),
      dayMovements: [mv('p1', 'IN', 200, 'PAYMENT'), mv('adj2', 'OUT', 20, 'ADJUST', { cashCountId: 'c-today' }), { ...mv('late', 'IN', 40, 'TOPUP'), date: '2026-10-30T18:00:00Z' }],
    })
    // the count's own difference (what was approved); 40 came in after the count
    expect([s.expected, s.difference, s.afterCount, s.state, s.totalOut]).toEqual([740, -20, 40, 'APPROVED', 0])
  })
  it('movements are grouped by kind, money in first', () => {
    const s = buildSheet({ computedOpening: 0, yesterdayCount: null, count: null, dayMovements: [mv('t', 'IN', 10, 'TOPUP'), mv('p1', 'IN', 20, 'PAYMENT'), mv('p22', 'IN', 30, 'PAYMENT'), mv('s', 'OUT', 5, 'SALARY'), mv('e', 'OUT', 7, 'EXPENSE')] })
    expect(s.inGroups.map((g) => [g.kind, g.count, g.amount])).toEqual([['PAYMENT', 2, 50], ['TOPUP', 1, 10]])
    expect(s.outGroups.map((g) => g.kind)).toEqual(['EXPENSE', 'SALARY'])
  })
  it('totals of several accounts count the ones not counted yet', () => {
    const a = buildSheet({ computedOpening: 100, yesterdayCount: null, count: count(100), dayMovements: [] })
    const b = buildSheet({ computedOpening: 50, yesterdayCount: null, count: null, dayMovements: [mv('p', 'IN', 25, 'PAYMENT')] })
    expect(sheetTotals([a, b])).toEqual({ opening: 150, totalIn: 25, totalOut: 0, expected: 175, counted: 100, difference: 0, notCounted: 1 })
  })
})
