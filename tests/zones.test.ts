import { describe, expect, it } from 'vitest'
import { cairoInstant, nextCairoDay, slotInZone, zoneOffsetMinutes } from '@/lib/dates/zones'

describe('Cairo group times in other time zones', () => {
  it('reads the Cairo offset (winter +2, summer +3)', () => {
    expect(zoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Africa/Cairo')).toBe(120)
    expect(zoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Africa/Cairo')).toBe(180)
  })
  it('turns a Cairo wall time into the right instant', () => {
    expect(cairoInstant('2026-01-17', '17:00').toISOString()).toBe('2026-01-17T15:00:00.000Z')
    expect(cairoInstant('2026-07-18', '17:00').toISOString()).toBe('2026-07-18T14:00:00.000Z')
  })
  it('finds the next date on a weekday', () => {
    expect(nextCairoDay('2026-11-13', 6)).toBe('2026-11-14') // Friday → Saturday
    expect(nextCairoDay('2026-11-14', 6)).toBe('2026-11-14')
  })
  it('shows the slot in the family zone, also across midnight', () => {
    expect(slotInZone({ dayOfWeek: 6, time: '17:00' }, 'Asia/Dubai', '2026-11-13')).toEqual({ dayOfWeek: 6, time: '19:00' })
    expect(slotInZone({ dayOfWeek: 6, time: '23:00' }, 'Asia/Riyadh', '2026-11-13')).toEqual({ dayOfWeek: 0, time: '00:00' })
    expect(slotInZone({ dayOfWeek: 6, time: '17:00' }, 'Africa/Cairo', '2026-11-13')).toBeNull()
    expect(slotInZone({ dayOfWeek: 6, time: '17:00' }, '', '2026-11-13')).toBeNull()
  })
})
