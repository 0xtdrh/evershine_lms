import { describe, expect, it } from 'vitest'
import { readStatement } from '@/lib/treasury/reconcile'

describe('bank statement file (FIN-3)', () => {
  it('reads a CSV with debit / credit columns', async () => {
    const csv = 'Date,Description,Debit,Credit,Reference\n2026-10-17,Deposit from branch,,100.00,TN-TRF-2026-00001\n2026-10-17,Bank fees,15.00,,BF-1\n'
    const r = await readStatement(new TextEncoder().encode(csv).buffer as ArrayBuffer, 'statement.csv')
    expect(r?.lines.map((l) => [l.date, l.amount, l.reference])).toEqual([['2026-10-17', 100, 'TN-TRF-2026-00001'], ['2026-10-17', -15, 'BF-1']])
  })
})
