import { describe, expect, it } from 'vitest'
import {
  addMonths, autoLockDue, canLockYm, cleanSettings, DEFAULT_MONTH_CLOSE_SETTINGS, isLocked, latestLockedEnd, monthRange,
  rowYm, touchesClosedFields, ymOf,
} from '@/lib/month-close/rules'

describe('month close — months in Cairo time', () => {
  it('a payment late on the last evening belongs to that month (Cairo), not the next UTC day', () => {
    expect(ymOf(new Date('2026-09-30T20:30:00Z'))).toBe('2026-09') // 23:30 Cairo (summer +3)
    expect(ymOf(new Date('2026-09-30T21:30:00Z'))).toBe('2026-10') // 00:30 Cairo on 1 October
  })
  it('a @db.Date value keeps its own day', () => {
    expect(ymOf(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10')
    expect(ymOf(new Date('2026-08-31T00:00:00Z'))).toBe('2026-08')
  })
  it('month range starts at Cairo midnight', () => {
    const r = monthRange('2026-09')
    expect(r.from.toISOString()).toBe('2026-08-31T21:00:00.000Z')
    expect(r.to.toISOString()).toBe('2026-09-30T21:00:00.000Z')
    expect(r.dayFrom.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    const w = monthRange('2026-12')
    expect(w.from.toISOString()).toBe('2026-11-30T22:00:00.000Z') // winter +2
  })
  it('adds months across years', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
  })
  it('only a finished month can be closed', () => {
    const now = new Date('2026-10-26T10:00:00Z')
    expect(canLockYm('2026-09', now)).toBe(true)
    expect(canLockYm('2026-10', now)).toBe(false)
    expect(canLockYm('2026-13', now)).toBe(false)
  })
})

describe('month close — which rows are closed', () => {
  const locks = [{ ym: '2026-08', scopeKey: 'ALL' }, { ym: '2026-09', scopeKey: 'branchA' }]
  it('company close covers every branch and company rows; a branch close only that branch', () => {
    expect(isLocked(locks, '2026-08', ['branchB'])).toBe(true)
    expect(isLocked(locks, '2026-08', [])).toBe(true)
    expect(isLocked(locks, '2026-09', ['branchA'])).toBe(true)
    expect(isLocked(locks, '2026-09', ['branchB'])).toBe(false)
    expect(isLocked(locks, '2026-09', [])).toBe(false) // a company row (e.g. a salary slip) needs a company close
  })
  it('newer rows are skipped quickly', () => {
    expect(latestLockedEnd([])).toBeNull()
    expect(latestLockedEnd(locks)!.getTime()).toBeGreaterThan(monthRange('2026-09').to.getTime())
  })
  it('dates each kind of row by the day it happened', () => {
    expect(rowYm('FeePayment', { paymentDate: new Date('2026-10-03T08:00:00Z'), createdAt: new Date('2026-10-03T08:00:00Z') })).toBe('2026-10')
    expect(rowYm('Refund', { approvedAt: null })).toBeNull() // waiting refunds belong to no month yet
    expect(rowYm('SalarySlip', { salaryPeriodStart: new Date('2026-09-01T00:00:00Z') })).toBe('2026-09')
    expect(rowYm('Unknown', { date: new Date() })).toBeNull()
  })
})

describe('month close — what may still change on a closed row', () => {
  const slip = { status: 'ISSUED', approvalStatus: 'APPROVED', netSalary: 5000, paymentDate: null }
  it('paying last month\'s salary is allowed; changing its amount or cancelling it is not', () => {
    expect(touchesClosedFields('SalarySlip', { status: 'PAID', paymentDate: new Date() }, slip)).toBe(false)
    expect(touchesClosedFields('SalarySlip', { netSalary: 5100 }, slip)).toBe(true)
    expect(touchesClosedFields('SalarySlip', { status: 'CANCELLED' }, slip)).toBe(true)
  })
  it('writing the same value again is not a change', () => {
    expect(touchesClosedFields('Expense', { amount: 300, title: 'Rent' }, { amount: { toNumber: () => 300, valueOf: () => 300 }, title: 'Rent' })).toBe(false)
    expect(touchesClosedFields('Expense', { amount: 301 }, { amount: 300 })).toBe(true)
    expect(touchesClosedFields('Expense', { notes: 'scan added' }, { notes: null })).toBe(false)
  })
})

describe('month close — automatic close', () => {
  const on = cleanSettings({ autoLock: true, autoLockDay: 5 })
  it('waits for the day, and never re-closes a month a Super Admin reopened', () => {
    expect(autoLockDue({ settings: on, now: new Date('2026-10-04T10:00:00Z'), lastMonthRow: null, pending: {} })).toBe(false)
    expect(autoLockDue({ settings: on, now: new Date('2026-10-05T10:00:00Z'), lastMonthRow: null, pending: {} })).toBe(true)
    expect(autoLockDue({ settings: on, now: new Date('2026-10-05T10:00:00Z'), lastMonthRow: { status: 'OPEN' }, pending: {} })).toBe(false)
  })
  it('does not close while things are still waiting, and is off by default', () => {
    expect(autoLockDue({ settings: on, now: new Date('2026-10-06T10:00:00Z'), lastMonthRow: null, pending: { refunds: 2 } })).toBe(false)
    expect(autoLockDue({ settings: DEFAULT_MONTH_CLOSE_SETTINGS, now: new Date('2026-10-06T10:00:00Z'), lastMonthRow: null, pending: {} })).toBe(false)
  })
  it('keeps the days between 1 and 28', () => {
    expect(cleanSettings({ autoLockDay: 31, remindDay: 0 })).toMatchObject({ autoLockDay: 28, remindDay: 1 })
  })
})
