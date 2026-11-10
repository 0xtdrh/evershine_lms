import { describe, expect, it } from 'vitest'
import { attention, change, continuation, monthList, newAndStopped, nps, stayAndValue, targetState, ymAdd, type MonthRow, type StudentSpan } from '@/lib/business/calc'

const row = (o: Partial<MonthRow>): MonthRow => ({ ym: '2026-10', income: 0, refunds: 0, expenses: 0, salaries: 0, profit: null, active: 0, newStudents: 0, stopped: 0, continuation: null, attendancePct: null, sessions: 0, cancelled: 0, invoiced: 0, collected: 0, collectionPct: null, rating: null, ratings: 0, complaints: 0, nps: null, requests: 0, inquiries: 0, referrals: 0, lessonViews: 0, activeUsers: null, perStudent: null, ...o })

describe('business growth maths', () => {
  it('months step over the year', () => {
    expect(ymAdd('2026-01', -1)).toBe('2025-12')
    expect(ymAdd('2026-12', 1)).toBe('2027-01')
    expect(monthList('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02'])
  })
  it('change in % needs something to compare with', () => {
    expect(change(120, 100)).toBe(20)
    expect(change(50, 0)).toBeNull()
    expect(change(null, 10)).toBeNull()
  })
  it('NPS = promoters − detractors', () => {
    expect(nps([10, 9, 8, 6, 0])).toBe(0)
    expect(nps([10, 10, 9, 7])).toBe(75)
    expect(nps([])).toBeNull()
  })
  it('new = first month, stopped = last month only when over and not in a group now', () => {
    const spans: StudentSpan[] = [
      { studentId: 'a', first: '2026-09', last: '2026-10', months: 2, activeNow: false, netPaid: 1000 },
      { studentId: 'b', first: '2026-10', last: '2026-11', months: 2, activeNow: true, netPaid: 800 },
      { studentId: 'c', first: '2026-10', last: '2026-11', months: 2, activeNow: false, netPaid: 500 }, // last = running month: not stopped yet
    ]
    const r = newAndStopped(spans, ['2026-09', '2026-10', '2026-11'], '2026-11')
    expect(r.get('2026-09')).toEqual({ new: 1, stopped: 0 })
    expect(r.get('2026-10')).toEqual({ new: 2, stopped: 1 })
    expect(r.get('2026-11')).toEqual({ new: 0, stopped: 0 })
  })
  it('continuation only for finished months', () => {
    const by = new Map([['2026-09', new Set(['a', 'b', 'c', 'd'])], ['2026-10', new Set(['a', 'b', 'c', 'x'])], ['2026-11', new Set(['a'])]])
    const c = continuation(by, ['2026-10', '2026-11'], '2026-11')
    expect(c.get('2026-10')).toBe(75)
    expect(c.get('2026-11')).toBeNull()
  })
  it('where students stop and what they paid', () => {
    const v = stayAndValue([
      { studentId: 'a', first: '2026-01', last: '2026-01', months: 1, activeNow: false, netPaid: 300 },
      { studentId: 'b', first: '2026-01', last: '2026-01', months: 1, activeNow: false, netPaid: 500 },
      { studentId: 'c', first: '2026-01', last: '2026-05', months: 5, activeNow: false, netPaid: 2000 },
      { studentId: 'd', first: '2026-01', last: '2026-11', months: 11, activeNow: true, netPaid: 4000 },
    ], '2026-11')
    expect(v.stoppedCount).toBe(3)
    expect(v.mostStopAt).toBe('1')
    expect(v.avgValue).toBe(933.33)
    expect(v.bands.find((b) => b.key === '4-6')?.count).toBe(1)
  })
  it('a target: counts follow the part of the month gone, rates do not', () => {
    expect(targetState('income', 5000, 10000, 0.5).state).toBe('ON_TRACK')
    expect(targetState('income', 3000, 10000, 0.5).state).toBe('BEHIND')
    expect(targetState('attendance', 95, 85, 0.2).state).toBe('AHEAD')
    expect(targetState('attendance', 70, 85, 1).state).toBe('BEHIND')
    expect(targetState('income', null, 100, 1).state).toBe('NONE')
  })
  it('needs your attention: plain rules', () => {
    const keys = attention({
      last: row({ ym: '2026-10', continuation: 60, attendancePct: 70, collectionPct: 50, income: 10000, complaints: 4, rating: 3, ratings: 10, newStudents: 5 }),
      before: row({ ym: '2026-09', continuation: 80, complaints: 1 }),
      yearAgo: row({ ym: '2025-10', newStudents: 10 }),
      overdue: 5000, fullWithWaiting: 2,
      places: [{ name: 'Branch A', income: 500, incomeBefore: 2000, attendancePct: 60 }],
      behind: [{ en: 'Income (EGP)', ar: 'الدخل (جنيه)' }],
    }).map((a) => a.key)
    expect(keys).toEqual(expect.arrayContaining(['continuation', 'attendance', 'collection', 'overdue', 'capacity', 'rating', 'complaints', 'newYoy', 'placeIncome:Branch A', 'placeAtt:Branch A', 'target:Income (EGP)']))
    expect(attention({ last: row({}), before: row({}), yearAgo: undefined, overdue: 0, fullWithWaiting: 0, places: [], behind: [] })).toEqual([])
  })
})
