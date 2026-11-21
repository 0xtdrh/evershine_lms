import { describe, expect, it } from 'vitest'
import { filterRecorded, summarizeByCourse, endsWithinWeek, type RecordedRowLike } from '@/lib/recorded/list-view'

const now = new Date('2026-11-21T10:00:00Z')
const row = (id: string, p: Partial<RecordedRowLike>): RecordedRowLike => ({
  id, level: 'Arduino 1', state: 'OPEN', endsAt: '2026-12-20T00:00:00Z', campus: { id: 'c1', name: 'Dahar' },
  student: { id: `s${id}`, name: `Student ${id}` }, progress: { pct: 50 }, ...p,
})
const rows = [
  row('1', { progress: { pct: 80 } }),
  row('2', { progress: { pct: 20 }, endsAt: '2026-11-25T00:00:00Z' }),
  row('3', { state: 'NOT_PAID', progress: null }),
  row('4', { level: 'Scratch 1', state: 'EXPIRED', campus: { id: 'c2', name: 'Sakkala' } }),
]

describe('recorded courses: who is in which course (owner 17/11)', () => {
  it('a card per course: open / waiting / ended and the average progress of the open ones', () => {
    expect(summarizeByCourse(rows)).toEqual([
      { level: 'Arduino 1', open: 2, waiting: 1, ended: 0, total: 3, avgPct: 50 },
      { level: 'Scratch 1', open: 0, waiting: 0, ended: 1, total: 1, avgPct: null },
    ])
  })
  it('filters: course, state, place, ending within a week, name', () => {
    expect(filterRecorded(rows, { level: 'Scratch 1' }, now).map((r) => r.id)).toEqual(['4'])
    expect(filterRecorded(rows, { state: 'NOT_PAID' }, now).map((r) => r.id)).toEqual(['3'])
    expect(filterRecorded(rows, { campusId: 'c2' }, now).map((r) => r.id)).toEqual(['4'])
    expect(filterRecorded(rows, { endingSoon: true }, now).map((r) => r.id)).toEqual(['2'])
    expect(filterRecorded(rows, { search: 'student 3' }, now).map((r) => r.id)).toEqual(['3'])
  })
  it('order: soonest end first by default; lowest progress first', () => {
    expect(filterRecorded(rows, {}, now)[0].id).toBe('2')
    expect(filterRecorded(rows, { sort: 'PROGRESS_LOW' }, now).map((r) => r.id).slice(0, 2)).toEqual(['3', '2'])
  })
  it('an ended course never counts as ending soon', () => {
    expect(endsWithinWeek(row('x', { state: 'EXPIRED', endsAt: '2026-11-22T00:00:00Z' }), now)).toBe(false)
  })
})
