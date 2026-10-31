import { describe, expect, it } from 'vitest'
import { cleanRoomsSettings, dailyOverflow, overlaps, roomClash, roomUsage, seatLimit, type Booking } from '@/lib/rooms/rules'

const b = (groupId: string, dayOfWeek: number, time: string, roomId?: string): Booking => ({ groupId, label: groupId, dayOfWeek, time, roomId })

describe('rooms — clashes', () => {
  it('times overlap inside one session length', () => {
    expect(overlaps('16:00', '17:00', 90)).toBe(true)
    expect(overlaps('16:00', '17:30', 90)).toBe(false)
  })
  it('the same room, same day, overlapping time = clash; other day / room / own group = fine', () => {
    const others = [b('A', 0, '16:00', 'r1'), b('B', 1, '16:00', 'r1'), b('C', 0, '16:00', 'r2')]
    expect(roomClash(b('X', 0, '17:00', 'r1'), others, 90)?.groupId).toBe('A')
    expect(roomClash(b('X', 1, '18:00', 'r1'), others, 90)).toBeNull()
    expect(roomClash(b('A', 0, '16:00', 'r1'), others, 90)).toBeNull()
    expect(roomClash(b('X', 0, '16:00'), others, 90)).toBeNull()
  })
  it('a place with a number of rooms per day: no more sessions at once than rooms', () => {
    const counts = new Map([[0, 2], [2, 1]])
    const others = [b('A', 0, '16:00'), b('B', 0, '16:30'), b('C', 2, '10:00')]
    expect(dailyOverflow(b('X', 0, '17:00'), others, counts, 90)).toEqual({ used: 3, have: 2 })
    expect(dailyOverflow(b('X', 0, '19:00'), others, counts, 90)).toBeNull()
    expect(dailyOverflow(b('X', 4, '10:00'), others, counts, 90)).toEqual({ used: 1, have: 0 }) // no rooms that day
  })
})

describe('rooms — seats and use', () => {
  it('a group takes no more than its own limit and its smallest room', () => {
    expect(seatLimit(null, [])).toBeNull()
    expect(seatLimit(12, [])).toBe(12)
    expect(seatLimit(null, [10, 8])).toBe(8)
    expect(seatLimit(6, [10])).toBe(6)
  })
  it('weekly use per room', () => {
    const u = roomUsage([{ id: 'r1' }, { id: 'r2' }], [b('A', 0, '16:00', 'r1'), b('B', 2, '10:00', 'r1')], 90)
    expect(u.map((x) => x.minutesPerWeek)).toEqual([180, 0])
  })
  it('session length stays sensible', () => {
    expect(cleanRoomsSettings({ sessionMinutes: 5 })).toEqual({ sessionMinutes: 15 })
    expect(cleanRoomsSettings({ sessionMinutes: 120 })).toEqual({ sessionMinutes: 120 })
  })
})
