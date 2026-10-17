import { describe, expect, it } from 'vitest'
import { forecastNext30, monthlyFlow, monthsBack, wherePound, type Move } from '@/lib/finance/calc'

const mv = (date: string, direction: 'IN' | 'OUT', amount: number, kind: string, category?: string): Move => ({ date: `${date}T10:00:00.000Z`, direction, amount, kind, category })

describe('FIN-3 money maths', () => {
  it('months back over a year end', () => {
    expect(monthsBack('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })
  it('monthly flow: in / out / running total, transfers left out', () => {
    const rows = monthlyFlow([
      mv('2026-09-03', 'IN', 1000, 'PAYMENT'), mv('2026-09-10', 'OUT', 300, 'EXPENSE'),
      mv('2026-10-01', 'IN', 500, 'TOPUP'), mv('2026-10-02', 'OUT', 700, 'SALARY'), mv('2026-10-02', 'OUT', 400, 'TRANSFER'), mv('2026-10-02', 'IN', 400, 'TRANSFER'),
      mv('2026-07-01', 'IN', 99, 'PAYMENT'),
    ], ['2026-09', '2026-10'], 200)
    expect(rows.map((r) => [r.month, r.in, r.out, r.net, r.running])).toEqual([['2026-09', 1000, 300, 700, 900], ['2026-10', 500, 700, -200, 700]])
    expect(rows[1].byKind).toEqual({ TOPUP: { in: 500, out: 0 }, SALARY: { in: 0, out: 700 } })
  })
  it('forecast: due soon in, average past out, overdue not counted', () => {
    expect(forecastNext30({ dueSoon: 3000, overdue: 900, pastOut: [2000, 0, 4000], balanceNow: 500 })).toEqual({ expectedIn: 3000, overdue: 900, expectedOut: 3000, balanceNow: 500, balanceAfter: 500, basisMonths: 2 })
    expect(forecastNext30({ dueSoon: 0, overdue: 0, pastOut: [1000], balanceNow: 200 }).balanceAfter).toBe(-800)
  })
  it('where every pound: lines, expense categories, kept and shares', () => {
    const w = wherePound([
      mv('2026-10-01', 'IN', 800, 'PAYMENT'), mv('2026-10-01', 'IN', 200, 'TOPUP'),
      mv('2026-10-02', 'OUT', 300, 'EXPENSE', 'Rent'), mv('2026-10-03', 'OUT', 100, 'EXPENSE', 'Rent'), mv('2026-10-03', 'OUT', 50, 'EXPENSE', 'Internet'),
      mv('2026-10-04', 'OUT', 250, 'SALARY'), mv('2026-10-04', 'OUT', 999, 'TRANSFER'),
    ])
    expect(w.totalIn).toBe(1000)
    expect(w.totalOut).toBe(700)
    expect(w.kept).toBe(300)
    expect(w.keptPct).toBe(30)
    expect(w.out).toEqual([{ key: 'EXPENSE', category: 'Rent', amount: 400, pct: 40 }, { key: 'SALARY', amount: 250, pct: 25 }, { key: 'EXPENSE', category: 'Internet', amount: 50, pct: 5 }])
  })
})
