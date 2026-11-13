import { describe, expect, it } from 'vitest'
import { canTakeAttendance, daysBetween, nextMonthStage, nextSlotDate, startAlertDue, startState } from '@/lib/groups/start-rules'

const g = (over: Partial<Parameters<typeof startState>[0]> = {}) => ({ minStudents: 6, count: 4, startDate: null, cancelledAt: null, startConfirmedAt: null, startForced: false, ...over })

describe('group start with a minimum', () => {
  it('waits for the minimum; ready when reached, forced or confirmed; started / cancelled win', () => {
    expect(startState(g())).toBe('WAITING_COUNT')
    expect(startState(g({ count: 6 }))).toBe('READY')
    expect(startState(g({ startForced: true }))).toBe('READY')
    expect(startState(g({ startConfirmedAt: '2026-11-20' }))).toBe('READY')
    expect(startState(g({ startDate: '2026-12-01' }))).toBe('STARTED')
    expect(startState(g({ cancelledAt: '2026-11-25' }))).toBe('CANCELLED')
    expect(startState(g({ minStudents: null }))).toBe('NO_MINIMUM')
  })
  it('attendance waits for the minimum', () => {
    expect(canTakeAttendance('WAITING_COUNT')).toBe(false)
    expect(canTakeAttendance('CANCELLED')).toBe(false)
    expect(canTakeAttendance('READY')).toBe(true)
    expect(canTakeAttendance('NO_MINIMUM')).toBe(true)
  })
  it('first session date from the weekly schedule', () => {
    expect(nextSlotDate([{ dayOfWeek: 6, time: '17:00' }], '2026-12-01')).toBe('2026-12-05') // Tuesday → Saturday
    expect(nextSlotDate([{ dayOfWeek: 2, time: '17:00' }, { dayOfWeek: 6, time: '17:00' }], '2026-12-01')).toBe('2026-12-01')
    expect(nextSlotDate([], '2026-12-01')).toBeNull()
  })
  it('the staff alert comes N days before the expected start, once', () => {
    expect(daysBetween('2026-11-26', '2026-12-01')).toBe(5)
    expect(startAlertDue('WAITING_COUNT', '2026-12-01', '2026-11-25', 5, false)).toBe(false)
    expect(startAlertDue('WAITING_COUNT', '2026-12-01', '2026-11-26', 5, false)).toBe(true)
    expect(startAlertDue('WAITING_COUNT', '2026-12-01', '2026-11-26', 5, true)).toBe(false)
    expect(startAlertDue('READY', '2026-12-01', '2026-11-30', 5, false)).toBe(false)
  })
  it('next month: remind 3 days before, on the day, lock after', () => {
    expect(nextMonthStage('2026-12-05', '2026-11-30', 0)).toBe(0)
    expect(nextMonthStage('2026-12-05', '2026-12-02', 0)).toBe(1)
    expect(nextMonthStage('2026-12-05', '2026-12-05', 1)).toBe(2)
    expect(nextMonthStage('2026-12-05', '2026-12-06', 2)).toBe(3)
    expect(nextMonthStage('2026-12-05', '2026-12-02', 3)).toBe(3)
    expect(nextMonthStage(null, '2026-12-02', 0)).toBe(0)
  })
})
