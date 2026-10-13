import { describe, expect, it } from 'vitest'
import { paidByTechNovaBetween, paidByTechNovaOn, periodsProblem, pickPayRule } from '@/lib/teachers/employment'

const d = (s: string) => new Date(s)
const mona = [
  { employer: 'TECHNOVA', kind: 'TRAINEE', fromDate: d('2026-09-01'), toDate: d('2026-12-31') },
  { employer: 'PARTNER', kind: 'TEACHER', fromDate: d('2027-01-01'), toDate: null },
]

describe('employment periods', () => {
  it('no periods = paid as before', () => {
    expect(paidByTechNovaOn([], d('2026-10-01'))).toBe(true)
  })
  it('a trainee and a partner instructor are not paid by TechNova', () => {
    expect(paidByTechNovaOn(mona, d('2026-10-01'))).toBe(false)
    expect(paidByTechNovaOn(mona, d('2027-02-01'))).toBe(false)
  })
  it('paid in a TechNova teacher period; between dates', () => {
    const p = [{ employer: 'TECHNOVA', kind: 'TEACHER', fromDate: d('2026-10-15'), toDate: null }]
    expect(paidByTechNovaOn(p, d('2026-10-14'))).toBe(false)
    expect(paidByTechNovaOn(p, d('2026-10-15'))).toBe(true)
    expect(paidByTechNovaBetween(p, d('2026-10-01'), d('2026-10-20'))).toBe(true)
    expect(paidByTechNovaBetween(mona, d('2026-10-01'), d('2026-10-20'))).toBe(false)
  })
  it('overlaps and backwards periods are refused', () => {
    expect(periodsProblem(mona)).toBeNull()
    expect(periodsProblem([...mona, { employer: 'TECHNOVA', kind: 'TEACHER', fromDate: d('2026-12-01'), toDate: null }])).toBe('Two periods overlap')
    expect(periodsProblem([{ employer: 'TECHNOVA', kind: 'TEACHER', fromDate: d('2026-10-10'), toDate: d('2026-10-01') }])).toBe('A period ends before it starts')
  })
})

describe('pay rule level', () => {
  const r = (fixed: number | null, perSession: number | null = null) => ({ fixed, percent: null, perSession })
  it('group > place > instructor default', () => {
    expect(pickPayRule(r(500), r(300), r(100)).source).toBe('GROUP_OVERRIDE')
    expect(pickPayRule(r(null), r(null, 200), r(100))).toMatchObject({ source: 'PLACE_RATE', rule: { perSession: 200 } })
    expect(pickPayRule(null, null, r(100)).source).toBe('TEACHER_DEFAULT')
    expect(pickPayRule(null, null, null).source).toBe('NONE')
  })
})
