import { describe, it, expect } from 'vitest'
import { cairoYmd, isBirthdayOn, birthdayInYear, ageOn, daysUntilBirthday, addDays, isLeapYear } from '@/lib/dates/cairo'
import { resolveExcuseRule, excuseWindow, EXCUSE_DEFAULT } from '@/lib/excuses/rules'
import { attendanceStats, numberSessions, isPerfectAttendance } from '@/lib/attendance/timeline-calc'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('Cairo dates', () => {
  it('uses Egypt time, not UTC (23:30 UTC on 1 Oct is already 2 Oct in Cairo)', () => {
    expect(cairoYmd(new Date('2026-10-01T23:30:00Z'))).toEqual({ y: 2026, m: 10, d: 2 })
    expect(cairoYmd(new Date('2026-10-01T10:00:00Z'))).toEqual({ y: 2026, m: 10, d: 1 })
  })
  it('leap years', () => {
    expect(isLeapYear(2028)).toBe(true)
    expect(isLeapYear(2027)).toBe(false)
    expect(isLeapYear(2100)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
  })
  it('29 February birthdays are celebrated on 28 February in non-leap years', () => {
    expect(birthdayInYear(d('2016-02-29'), 2027)).toEqual({ m: 2, d: 28 })
    expect(birthdayInYear(d('2016-02-29'), 2028)).toEqual({ m: 2, d: 29 })
    expect(isBirthdayOn(d('2016-02-29'), { y: 2027, m: 2, d: 28 })).toBe(true)
    expect(isBirthdayOn(d('2016-02-29'), { y: 2027, m: 3, d: 1 })).toBe(false)
    expect(isBirthdayOn(d('2016-02-29'), { y: 2028, m: 2, d: 28 })).toBe(false)
  })
  it('normal birthday and age', () => {
    expect(isBirthdayOn(d('2015-10-03'), { y: 2026, m: 10, d: 3 })).toBe(true)
    expect(ageOn(d('2015-10-03'), { y: 2026, m: 10, d: 3 })).toBe(11)
    expect(ageOn(d('2015-10-03'), { y: 2026, m: 10, d: 2 })).toBe(10)
    expect(isBirthdayOn(null, { y: 2026, m: 10, d: 3 })).toBe(false)
  })
  it('days until the next birthday within a window, across the year end', () => {
    expect(daysUntilBirthday(d('2015-01-02'), { y: 2026, m: 12, d: 30 }, 6)).toBe(3)
    expect(daysUntilBirthday(d('2015-01-20'), { y: 2026, m: 12, d: 30 }, 6)).toBeNull()
    expect(addDays({ y: 2026, m: 12, d: 31 }, 1)).toEqual({ y: 2027, m: 1, d: 1 })
  })
})

describe('Excuse settings', () => {
  const rules = [
    { scopeType: 'ALL', scopeId: null, autoApprove: true, daysAfter: 2 },
    { scopeType: 'TRACK', scopeId: 't1', autoApprove: false, daysAfter: 1 },
    { scopeType: 'GROUP', scopeId: 'g1', autoApprove: true, daysAfter: 0 },
  ]
  it('the most specific rule wins (group → course → track → everyone)', () => {
    expect(resolveExcuseRule(rules, { groupId: 'g1', courseId: 'c1', trackId: 't1' })).toMatchObject({ autoApprove: true, daysAfter: 0, scopeType: 'GROUP' })
    expect(resolveExcuseRule(rules, { groupId: 'g2', courseId: 'c1', trackId: 't1' })).toMatchObject({ autoApprove: false, daysAfter: 1, scopeType: 'TRACK' })
    expect(resolveExcuseRule(rules, { groupId: 'g2', courseId: 'c9', trackId: 't9' })).toMatchObject({ autoApprove: true, daysAfter: 2, scopeType: 'ALL' })
  })
  it('no rule = automatic, up to 2 days after', () => {
    expect(resolveExcuseRule([], { groupId: 'x' })).toEqual(EXCUSE_DEFAULT)
    expect(EXCUSE_DEFAULT).toMatchObject({ autoApprove: true, daysAfter: 2 })
  })
  it('time window: before the session, or up to N days after', () => {
    expect(excuseWindow('2026-10-05', '2026-10-03', 2).ok).toBe(true) // future
    expect(excuseWindow('2026-10-03', '2026-10-03', 0).ok).toBe(true) // same day
    expect(excuseWindow('2026-10-01', '2026-10-03', 2).ok).toBe(true) // 2 days after
    expect(excuseWindow('2026-09-30', '2026-10-03', 2).ok).toBe(false) // 3 days after
    expect(excuseWindow('2026-10-02', '2026-10-03', 0).ok).toBe(false)
    expect(excuseWindow('2027-01-30', '2026-10-03', 2).ok).toBe(false) // too far ahead
  })
})

describe('Per-session attendance', () => {
  it('percentage = present + late over the sessions (excused is still an absence)', () => {
    expect(attendanceStats(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'])).toMatchObject({ sessions: 4, present: 1, late: 1, absent: 1, excused: 1, pct: 50 })
    expect(attendanceStats([]).pct).toBeNull()
  })
  it('numbers the student\'s sessions by the group\'s held dates ("3 of 8")', () => {
    const rows = numberSessions(['2026-10-01', '2026-10-04', '2026-10-08'], [{ date: '2026-10-08', status: 'ABSENT' }, { date: '2026-10-04', status: 'PRESENT' }], 8, new Map([['2026-10-08', 'cold']]))
    expect(rows).toEqual([
      { n: 2, of: 8, date: '2026-10-04', status: 'PRESENT', excuseReason: null },
      { n: 3, of: 8, date: '2026-10-08', status: 'ABSENT', excuseReason: 'cold' },
    ])
  })
  it('perfect attendance only for a finished month with no absence at all', () => {
    expect(isPerfectAttendance([{ status: 'PRESENT' }, { status: 'LATE' }], true)).toBe(true)
    expect(isPerfectAttendance([{ status: 'PRESENT' }, { status: 'EXCUSED' }], true)).toBe(false)
    expect(isPerfectAttendance([{ status: 'PRESENT' }], false)).toBe(false)
    expect(isPerfectAttendance([], true)).toBe(false)
  })
})
