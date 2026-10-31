import { describe, expect, it } from 'vitest'
import { cleanHours, hoursCover, teachClash, teachProblem, twoBranchesSameDay, type TeachSlot, type WorkHours } from '@/lib/teachers/work-hours'

const h = (dayOfWeek: number, fromTime: string, toTime: string, campusId: string | null = null, onlineOnly = false): WorkHours => ({ dayOfWeek, fromTime, toTime, campusId, onlineOnly })
const s = (groupId: string, dayOfWeek: number, time: string, campusId = 'A', mode: TeachSlot['mode'] = 'BRANCH'): TeachSlot => ({ groupId, label: groupId, dayOfWeek, time, mode, campusId })

describe('instructor working hours', () => {
  it('no hours entered = always available; recorded needs no time', () => {
    expect(hoursCover([], s('g', 0, '23:00'), 90)).toBe(true)
    expect(hoursCover([h(1, '10:00', '11:00')], s('g', 0, '16:00', 'A', 'RECORDED'), 90)).toBe(true)
  })
  it('the whole session must fit inside his hours of that day', () => {
    const hours = [h(0, '14:00', '20:00')]
    expect(hoursCover(hours, s('g', 0, '16:00'), 90)).toBe(true)
    expect(hoursCover(hours, s('g', 0, '19:00'), 90)).toBe(false)
    expect(hoursCover(hours, s('g', 1, '16:00'), 90)).toBe(false)
  })
  it('hours for one place, or online only', () => {
    expect(hoursCover([h(0, '14:00', '20:00', 'A')], s('g', 0, '16:00', 'B'), 90)).toBe(false)
    expect(hoursCover([h(0, '14:00', '20:00', 'A')], s('g', 0, '16:00', 'B', 'ONLINE'), 90)).toBe(true)
    expect(hoursCover([h(0, '14:00', '20:00', null, true)], s('g', 0, '16:00'), 90)).toBe(false)
    expect(hoursCover([h(0, '14:00', '20:00', null, true)], s('g', 0, '16:00', 'A', 'ONLINE'), 90)).toBe(true)
  })
  it('clashes, and two branches the same day', () => {
    const others = [s('x', 0, '16:00', 'A'), s('y', 2, '10:00', 'B', 'ONLINE')]
    expect(teachClash(s('g', 0, '17:00'), others, 90)?.groupId).toBe('x')
    expect(teachClash(s('g', 0, '17:30'), others, 90)).toBeNull()
    expect(twoBranchesSameDay(s('g', 0, '19:00', 'B'), others)?.groupId).toBe('x')
    expect(twoBranchesSameDay(s('g', 2, '18:00', 'A'), others)).toBeNull() // the other one is online
  })
  it('the first problem is reported', () => {
    expect(teachProblem([h(0, '14:00', '20:00')], [s('g', 0, '21:00')], [], 90)?.kind).toBe('HOURS')
    expect(teachProblem([], [s('g', 0, '16:30')], [s('x', 0, '16:00')], 90)?.kind).toBe('CLASH')
    expect(teachProblem([], [s('g', 0, '19:00', 'B')], [s('x', 0, '16:00', 'A')], 90)?.kind).toBe('TWO_BRANCHES')
    expect(teachProblem([], [s('g', 0, '19:00', 'A')], [s('x', 0, '16:00', 'A')], 90)).toBeNull()
  })
  it('cleans bad rows', () => {
    expect(cleanHours([h(0, '20:00', '14:00'), h(9, '10:00', '11:00'), h(1, '10:00', '11:00')])).toHaveLength(1)
  })
})
