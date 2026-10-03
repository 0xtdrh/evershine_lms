import { describe, expect, it } from 'vitest'
import { buildOccurrences, findConflicts, upcomingSessions, type GroupForCalendar } from '@/lib/groups/schedule-calendar'

// 2026-10-04 is a Sunday. Group meets Sun 16:00 + Tue 18:00, 4 sessions per cycle.
const g: GroupForCalendar = {
  id: 'g1',
  slots: [{ dayOfWeek: 0, time: '16:00' }, { dayOfWeek: 2, time: '18:00' }],
  completed: false,
  cycleStart: '2026-10-04',
  sessionsPerCycle: 4,
  heldDates: ['2026-10-04'],
  cancelledDates: [],
}
const pick = (o: ReturnType<typeof buildOccurrences>) => o.map((x) => `${x.date} ${x.time} ${x.status} ${x.sessionNumber ?? '-'}${x.isLastOfCycle ? ' last' : ''}`)

describe('groups calendar', () => {
  it('held, missing and upcoming sessions numbered up to the end of the cycle', () => {
    expect(pick(buildOccurrences(g, '2026-10-04', '2026-10-31', '2026-10-08'))).toEqual([
      '2026-10-04 16:00 HELD 1',
      '2026-10-06 18:00 MISSING -',
      '2026-10-11 16:00 SCHEDULED 2',
      '2026-10-13 18:00 SCHEDULED 3',
      '2026-10-18 16:00 SCHEDULED 4 last',
    ])
  })
  it('a cancelled date is shown and does not use a number', () => {
    const o = buildOccurrences({ ...g, cancelledDates: ['2026-10-11'] }, '2026-10-09', '2026-10-31', '2026-10-08')
    expect(pick(o)).toEqual(['2026-10-11 16:00 CANCELLED -', '2026-10-13 18:00 SCHEDULED 2', '2026-10-18 16:00 SCHEDULED 3', '2026-10-20 18:00 SCHEDULED 4 last'])
  })
  it('today already held: numbering continues after it', () => {
    const o = buildOccurrences({ ...g, heldDates: ['2026-10-04', '2026-10-06'] }, '2026-10-06', '2026-10-12', '2026-10-06')
    expect(pick(o)).toEqual(['2026-10-06 18:00 HELD 2', '2026-10-11 16:00 SCHEDULED 3'])
  })
  it('group not started yet: upcoming sessions from today, faded, numbered from 1', () => {
    const o = buildOccurrences({ ...g, cycleStart: null, heldDates: [] }, '2026-10-01', '2026-10-12', '2026-10-05')
    expect(pick(o)).toEqual(['2026-10-06 18:00 NOT_STARTED 1', '2026-10-11 16:00 NOT_STARTED 2'])
  })
  it('a held session on a day without a slot still shows', () => {
    const o = buildOccurrences({ ...g, heldDates: ['2026-10-04', '2026-10-07'] }, '2026-10-07', '2026-10-07', '2026-10-08')
    expect(pick(o)).toEqual(['2026-10-07  HELD 2'])
  })
  it('completed group: only what happened', () => {
    const o = buildOccurrences({ ...g, completed: true, heldDates: ['2026-10-04', '2026-10-06'] }, '2026-10-01', '2026-10-31', '2026-10-20')
    expect(pick(o)).toEqual(['2026-10-04 16:00 HELD 1', '2026-10-06 18:00 HELD 2'])
  })
  it('nothing projected past the range end, and nothing before the cycle start is "missing"', () => {
    expect(pick(buildOccurrences(g, '2026-09-27', '2026-10-03', '2026-10-08'))).toEqual([])
  })
  it('teacher conflicts: same teacher, date and time (cancelled ignored)', () => {
    const rows = [
      { teacherId: 't1', date: '2026-10-11', time: '16:00', status: 'SCHEDULED' as const },
      { teacherId: 't1', date: '2026-10-11', time: '16:00', status: 'SCHEDULED' as const },
      { teacherId: 't1', date: '2026-10-11', time: '18:00', status: 'SCHEDULED' as const },
      { teacherId: 't2', date: '2026-10-11', time: '16:00', status: 'SCHEDULED' as const },
      { teacherId: 't3', date: '2026-10-11', time: '16:00', status: 'CANCELLED' as const },
      { teacherId: 't3', date: '2026-10-11', time: '16:00', status: 'SCHEDULED' as const },
    ]
    expect([...findConflicts(rows)].sort()).toEqual([0, 1])
  })
})

describe('holidays and extra sessions (phase A)', () => {
  it('a holiday moves the session to the next slot (number kept)', () => {
    const o = buildOccurrences({ ...g, holidayDates: ['2026-10-11'] }, '2026-10-09', '2026-10-31', '2026-10-08')
    expect(pick(o)).toEqual(['2026-10-11 16:00 HOLIDAY -', '2026-10-13 18:00 SCHEDULED 2', '2026-10-18 16:00 SCHEDULED 3', '2026-10-20 18:00 SCHEDULED 4 last'])
  })
  it('an extra session counts and brings the end forward', () => {
    const o = buildOccurrences({ ...g, holidayDates: ['2026-10-11'], extras: [{ date: '2026-10-12', time: '17:00' }] }, '2026-10-09', '2026-10-31', '2026-10-08')
    expect(pick(o)).toEqual(['2026-10-11 16:00 HOLIDAY -', '2026-10-12 17:00 SCHEDULED 2', '2026-10-13 18:00 SCHEDULED 3', '2026-10-18 16:00 SCHEDULED 4 last'])
    expect(o.find((x) => x.date === '2026-10-12')?.isExtra).toBe(true)
  })
  it('upcomingSessions skips holidays, cancelled/held dates and adds extras', () => {
    expect(upcomingSessions({ slots: g.slots, from: '2026-10-08', count: 3, holidays: ['2026-10-11'], extras: [{ date: '2026-10-09', time: '10:00' }], skipDates: ['2026-10-13'] }))
      .toEqual([{ date: '2026-10-09', time: '10:00' }, { date: '2026-10-18', time: '16:00' }, { date: '2026-10-20', time: '18:00' }])
  })
  it('holidays are never a clash', () => {
    const rows = [
      { teacherId: 't1', date: '2026-10-11', time: '16:00', status: 'HOLIDAY' as const },
      { teacherId: 't1', date: '2026-10-11', time: '16:00', status: 'SCHEDULED' as const },
    ]
    expect([...findConflicts(rows)]).toEqual([])
  })
})
