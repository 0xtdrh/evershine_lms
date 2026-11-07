import { describe, expect, it } from 'vitest'
import fs from 'fs'
import { canDecide, cleanVoidSettings, invoiceAfterVoid, studentAfterVoid, voidProblem } from '@/lib/payments/void-rules'

const base = { settings: cleanVoidSettings(null), status: 'COMPLETED', source: 'STAFF', createdAt: new Date('2026-11-01T10:00:00Z'), now: new Date('2026-11-05T10:00:00Z'), amount: 500, invoicePaid: 500, invoiceRefunded: 0, reconciled: false }

describe('cancel a payment recorded by mistake', () => {
  it('settings: on, 7 days by default; bad values fall back', () => {
    expect(cleanVoidSettings(null)).toEqual({ enabled: true, maxDays: 7 })
    expect(cleanVoidSettings({ maxDays: 0 }).maxDays).toBe(7)
    expect(cleanVoidSettings({ enabled: false, maxDays: 3 })).toEqual({ enabled: false, maxDays: 3 })
  })
  it('a staff / proof / wallet payment inside the days can be cancelled', () => {
    expect(voidProblem(base)).toBeNull()
    expect(voidProblem({ ...base, source: 'PROOF' })).toBeNull()
    expect(voidProblem({ ...base, source: 'WALLET' })).toBeNull()
  })
  it('refused: switched off, already cancelled, online, too old, refunded, matched with the bank', () => {
    expect(voidProblem({ ...base, settings: cleanVoidSettings({ enabled: false }) })).toBe('OFF')
    expect(voidProblem({ ...base, status: 'VOIDED' })).toBe('NOT_COMPLETED')
    expect(voidProblem({ ...base, source: 'ONLINE' })).toBe('ONLINE')
    expect(voidProblem({ ...base, now: new Date('2026-11-08T10:00:01Z') })).toBe('TOO_OLD')
    expect(voidProblem({ ...base, now: new Date('2026-11-08T10:00:00Z') })).toBeNull() // exactly 7 days is still fine
    expect(voidProblem({ ...base, invoicePaid: 800, invoiceRefunded: 400 })).toBe('REFUNDED')
    expect(voidProblem({ ...base, invoicePaid: 800, invoiceRefunded: 300 })).toBeNull()
    expect(voidProblem({ ...base, reconciled: true })).toBe('RECONCILED')
  })
  it('the invoice goes back: partly paid, issued, or overdue', () => {
    const due = new Date('2026-11-10'), now = new Date('2026-11-05')
    expect(invoiceAfterVoid({ total: 1000, paid: 1000, amount: 400, dueDate: due, now })).toEqual({ paid: 600, status: 'PARTIALLY_PAID' })
    expect(invoiceAfterVoid({ total: 1000, paid: 400, amount: 400, dueDate: due, now })).toEqual({ paid: 0, status: 'ISSUED' })
    expect(invoiceAfterVoid({ total: 1000, paid: 400, amount: 400, dueDate: new Date('2026-11-01'), now })).toEqual({ paid: 0, status: 'OVERDUE' })
    expect(invoiceAfterVoid({ total: 1000, paid: 1500, amount: 500, dueDate: due, now }).status).toBe('PAID') // a double entry: the other one still pays it
  })
  it('the student summary goes back', () => {
    expect(studentAfterVoid({ paid: 1000, due: 0, amount: 500 })).toEqual({ paid: 500, due: 500, feeStatus: 'PARTIALLY_PAID' })
    expect(studentAfterVoid({ paid: 500, due: 0, amount: 500 })).toEqual({ paid: 0, due: 500, feeStatus: 'PENDING' })
  })
  it('never the person who asked; only with the approve permission', () => {
    expect(canDecide({ canApprove: true, userId: 'a', requestedById: 'b' })).toBe('OK')
    expect(canDecide({ canApprove: true, userId: 'a', requestedById: 'a' })).toBe('OWN')
    expect(canDecide({ canApprove: false, userId: 'a', requestedById: 'b' })).toBe('ROLE')
  })
  it('money totals skip cancelled payments (every place that adds payments up filters COMPLETED)', () => {
    for (const f of ['lib/finance/pnl-totals.ts', 'lib/insights/insights.ts', 'lib/teachers/pay-statement.ts', 'lib/month-close/report.ts', 'lib/partners/deal-engine.ts', 'lib/treasury/sync.ts', 'app/api/campuses/[id]/profile/route.ts', 'app/api/dashboard/route.ts', 'app/api/admin/reports/fees/route.ts']) {
      const t = fs.readFileSync(f, 'utf8')
      const sums = t.match(/feePayment\.aggregate\(\{[^)]*/g) ?? []
      for (const s of sums) expect(s, f).toMatch(/COMPLETED|feeWhere/) // feeWhere (P&L) holds status COMPLETED
    }
  })
})
