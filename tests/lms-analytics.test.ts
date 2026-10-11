import { describe, expect, it } from 'vitest'
import { avgPercent, bucketWeeks, gradingHours, homeworkStats, quizResults, riskReasons, weakPoints, weekStarts, type SubRow } from '@/lib/lms/analytics-calc'

const d = (s: string) => new Date(s)
const sub = (p: Partial<SubRow>): SubRow => ({ blockId: 'a1', studentId: 's1', status: 'SUBMITTED', late: false, submittedAt: d('2026-10-01'), gradedAt: null, gradedById: null, score: null, maxScore: null, ...p })

describe('homeworkStats', () => {
  it('counts on time, late and missing for every student × due homework', () => {
    const due = [{ blockId: 'a1', dueAt: d('2026-10-02') }, { blockId: 'a2', dueAt: d('2026-10-05') }]
    const subs = [sub({}), sub({ blockId: 'a2', late: true }), sub({ studentId: 's2', status: 'DRAFT' })]
    const r = homeworkStats(['s1', 's2'], due, subs)
    expect(r).toMatchObject({ expected: 4, onTime: 1, late: 1, missing: 2, onTimePct: 25, latePct: 25, missingPct: 50 })
  })
  it('no homework due = no percentages', () => {
    expect(homeworkStats(['s1'], [], []).onTimePct).toBeNull()
  })
})

describe('averages', () => {
  it('avgPercent skips rows without a max', () => {
    expect(avgPercent([{ score: 5, maxScore: 10 }, { score: 9, maxScore: 10 }, { score: 3, maxScore: null }])).toBe(70)
    expect(avgPercent([])).toBeNull()
  })
  it('gradingHours counts only instructor grades', () => {
    expect(gradingHours([
      { submittedAt: d('2026-10-01T10:00:00Z'), gradedAt: d('2026-10-02T10:00:00Z'), gradedById: 'u' },
      { submittedAt: d('2026-10-01T10:00:00Z'), gradedAt: d('2026-10-01T12:00:00Z'), gradedById: 'u' },
      { submittedAt: d('2026-10-01T10:00:00Z'), gradedAt: d('2026-10-01T10:00:01Z'), gradedById: null },
    ])).toBe(13)
  })
})

describe('quizResults', () => {
  it('uses the quiz scoring rule and the pass mark', () => {
    const att = (score: number, at: string, studentId = 's1') => ({ blockId: 'q1', studentId, status: 'GRADED', score, maxScore: 10, createdAt: d(at), submittedAt: d(at), gradedAt: null, gradedById: null })
    const rows = [att(3, '2026-10-01'), att(8, '2026-10-02'), att(4, '2026-10-01', 's2'), { ...att(10, '2026-10-03', 's3'), status: 'SUBMITTED' }]
    const r = quizResults(rows, [{ blockId: 'q1', passMark: 50, scoring: 'BEST' }])
    expect(r.find((x) => x.studentId === 's1')).toMatchObject({ percent: 80, passed: true })
    expect(r.find((x) => x.studentId === 's2')).toMatchObject({ percent: 40, passed: false })
    expect(r.find((x) => x.studentId === 's3')).toBeUndefined()
  })
})

describe('riskReasons', () => {
  const now = d('2026-10-20T12:00:00Z')
  const base = { studentId: 's1', subs: [] as SubRow[], results: [], lastViewAt: now, groupHasOpenLessons: true, groupStartDate: d('2026-09-01'), now }
  it('missed the last 2 homework', () => {
    const due = [{ blockId: 'a1', dueAt: d('2026-10-10') }, { blockId: 'a2', dueAt: d('2026-10-15') }, { blockId: 'a3', dueAt: d('2026-10-25') }]
    expect(riskReasons({ ...base, due })).toEqual(['MISSED_HOMEWORK'])
    expect(riskReasons({ ...base, due, subs: [sub({ blockId: 'a2' })] })).toEqual([])
    expect(riskReasons({ ...base, due: due.slice(0, 1) })).toEqual([])
  })
  it('last 2 quizzes under the pass mark', () => {
    const results = [{ studentId: 's1', passed: true, at: d('2026-10-01') }, { studentId: 's1', passed: false, at: d('2026-10-05') }, { studentId: 's1', passed: false, at: d('2026-10-09') }]
    expect(riskReasons({ ...base, due: [], results })).toEqual(['LOW_QUIZZES'])
    expect(riskReasons({ ...base, due: [], results: results.slice(0, 2) })).toEqual([])
  })
  it('no lesson opened for 14 days (only when the group has open lessons and is not brand new)', () => {
    expect(riskReasons({ ...base, due: [], lastViewAt: null })).toEqual(['INACTIVE'])
    expect(riskReasons({ ...base, due: [], lastViewAt: d('2026-10-10') })).toEqual([])
    expect(riskReasons({ ...base, due: [], lastViewAt: null, groupHasOpenLessons: false })).toEqual([])
    expect(riskReasons({ ...base, due: [], lastViewAt: null, groupStartDate: d('2026-10-15') })).toEqual([])
  })
})

describe('weeks', () => {
  it('starts on Sunday and buckets events', () => {
    const w = weekStarts(d('2026-10-07T00:00:00Z'), d('2026-10-20T23:00:00Z'))
    expect(w.map((x) => x.toISOString().slice(0, 10))).toEqual(['2026-10-04', '2026-10-11', '2026-10-18'])
    expect(bucketWeeks(w, [d('2026-10-04T01:00:00Z'), d('2026-10-12'), d('2026-10-13'), d('2026-09-01'), null])).toEqual([1, 2, 0])
  })
})

describe('weakPoints', () => {
  it('flags numbers under the limits and ignores empty ones', () => {
    expect(weakPoints({ openPct: 30, onTimePct: 80, quizAvg: null, homeworkAvg: 45 })).toEqual(['openPct', 'homeworkAvg'])
  })
})
