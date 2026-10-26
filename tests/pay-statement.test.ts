import { describe, expect, it } from 'vitest'
import { monthBounds, payKind, preDiscountValue, slipLinesFromStatement, statementGroup, statementTotals, type StatementGroupFacts } from '@/lib/teachers/pay-statement-calc'

const base = (over: Partial<StatementGroupFacts> = {}): StatementGroupFacts => ({
  id: 'g1', label: 'Robots 1 A', place: 'Branch', rule: { fixed: null, percent: null, perSession: 100 }, fixedCounts: false,
  sessions: [], students: [], adjustments: [], ...over,
})

describe('instructor pay statement (2026-10-26)', () => {
  it('per session: only the sessions he taught and TechNova paid count', () => {
    const g = statementGroup(base({ sessions: [
      { date: '2026-10-20', n: 1, of: 4, counted: true },
      { date: '2026-10-25', n: 2, of: 4, counted: false, otherTeacher: 'Coach 2' },
      { date: '2026-10-27', n: 3, of: 4, counted: false, notPaidByTechNova: true },
    ] }))
    expect(g.sessionsCounted).toBe(1)
    expect(g.sessionAmount).toBe(100)
    expect(g.payKind).toBe('PER_SESSION')
  })

  it('percent: the instructor share per student only, refunds lower it, never negative', () => {
    const g = statementGroup(base({ rule: { fixed: null, percent: 20, perSession: null }, students: [
      { student: 'Youssef', preDiscountPaid: 600 }, { student: 'Omar', preDiscountPaid: -50 }, { student: 'Mariam', preDiscountPaid: 0 },
    ] }))
    expect(g.studentShares).toEqual([{ student: 'Youssef', share: 120 }])
    expect(g.percentAmount).toBe(120)
  })

  it('fixed counts once (the month the group started); mixed pay', () => {
    const g = statementGroup(base({ rule: { fixed: 500, percent: null, perSession: 100 }, fixedCounts: true, sessions: [{ date: '2026-10-20', n: 1, of: 4, counted: true }] }))
    expect(g.fixedAmount).toBe(500)
    expect(g.total).toBe(600)
    expect(g.payKind).toBe('MIXED')
    expect(statementGroup(base({ rule: { fixed: 500, percent: null, perSession: null }, fixedCounts: false })).fixedAmount).toBe(0)
  })

  it('a group he only covered as a substitute pays only the substitute bonus', () => {
    const g = statementGroup(base({ coveredOnly: true, rule: { fixed: 999, percent: 50, perSession: 999 }, fixedCounts: true,
      sessions: [{ date: '2026-10-25', n: 2, of: 4, counted: true }], students: [{ student: 'X', preDiscountPaid: 1000 }],
      adjustments: [{ amount: 100, reason: 'Covered session 2', date: '2026-10-25', kind: 'SUBSTITUTE' }] }))
    expect(g.sessionAmount + g.percentAmount + g.fixedAmount).toBe(0)
    expect(g.total).toBe(100)
  })

  it('totals add groups and general bonuses / deductions', () => {
    const a = statementGroup(base({ sessions: [{ date: '2026-10-20', n: 1, of: 4, counted: true }], adjustments: [{ amount: -20, reason: 'late', date: '2026-10-21', kind: 'MANUAL' }] }))
    const b = statementGroup(base({ id: 'g2', label: 'Robots 2 B', coveredOnly: true, adjustments: [{ amount: 100, reason: 'cover', date: '2026-10-25', kind: 'SUBSTITUTE' }] }))
    const t = statementTotals([a, b], [{ amount: 50, reason: 'transport', date: '2026-10-30', kind: 'MANUAL' }])
    expect(t).toEqual({ sessions: 1, sessionAmount: 100, percentAmount: 0, fixedAmount: 0, earnings: 100, bonuses: 150, deductions: 20, net: 230 })
  })

  it('slip lines: one earning line per group, then each bonus / deduction', () => {
    const a = statementGroup(base({ sessions: [{ date: '2026-10-20', n: 1, of: 4, counted: true }], adjustments: [{ amount: -20, reason: 'late', date: '2026-10-21', kind: 'MANUAL' }] }))
    expect(slipLinesFromStatement([a])).toEqual([
      { label: 'Robots 1 A', value: 100, isDeduction: false },
      { label: 'Robots 1 A — late', value: 20, isDeduction: true },
    ])
  })

  it('helpers: pre-discount value, month bounds, pay kind', () => {
    expect(preDiscountValue(450, 600, 540)).toBe(500)
    expect(preDiscountValue(300, 600, 600)).toBe(300)
    expect(monthBounds('2026-10')!.from.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(monthBounds('2026-12')!.to.toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(monthBounds('2026-13')).toBeNull()
    expect(payKind({ fixed: null, percent: null, perSession: null })).toBe('NONE')
  })
})
