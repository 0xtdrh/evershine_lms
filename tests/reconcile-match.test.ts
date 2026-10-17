import { describe, expect, it } from 'vitest'
import { matchStatement, statementColumns, type BankLine, type SysMove } from '@/lib/treasury/reconcile-match'

const line = (row: number, date: string, amount: number, reference = ''): BankLine => ({ row, date, amount, description: '', reference })
const mv = (id: string, date: string, direction: 'IN' | 'OUT', amount: number, note: string | null = null): SysMove => ({ id, date, direction, amount, note, reconciled: false })

describe('bank reconciliation (FIN-3)', () => {
  it('same direction + amount within 3 days; each movement used once; leftovers on both sides', () => {
    const r = matchStatement(
      [line(2, '2026-10-01', 850), line(3, '2026-10-02', 850), line(4, '2026-10-05', -200), line(5, '2026-10-20', 999)],
      [mv('a', '2026-10-01', 'IN', 850), mv('b', '2026-10-03', 'IN', 850), mv('c', '2026-10-04', 'OUT', 200), mv('d', '2026-10-09', 'OUT', 50)],
    )
    expect(r.matched.map((m) => [m.line.row, m.move.id])).toEqual([[2, 'a'], [3, 'b'], [4, 'c']])
    expect(r.bankOnly.map((l) => l.row)).toEqual([5])
    expect(r.systemOnly.map((m) => m.id)).toEqual(['d'])
  })
  it('the bank reference beats a closer date', () => {
    const r = matchStatement([line(2, '2026-10-02', 500, 'TN-TRF-2026-00001')], [mv('near', '2026-10-02', 'IN', 500, 'other'), mv('ref', '2026-10-04', 'IN', 500, 'TN-TRF-2026-00001 ← box')])
    expect(r.matched[0].move.id).toBe('ref')
  })
  it('statement columns in English or Arabic, with debit / credit or one amount column', () => {
    expect(statementColumns(['التاريخ', 'البيان', 'مدين', 'دائن', 'الرصيد'])).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3, amount: -1 })
    expect(statementColumns(['Value Date', 'Details', 'Amount', 'Ref'])).toMatchObject({ date: 0, description: 1, amount: 2, reference: 3 })
  })
})
