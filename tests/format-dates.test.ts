import { describe, expect, it } from 'vitest'
import { dmy, dmyTime } from '@/lib/format/dates'

describe('dates shown day / month / year in Egypt time (2026-10-20)', () => {
  it('formats', () => {
    expect(dmy('2026-10-20T15:10:00Z')).toBe('20/10/2026')
    expect(dmyTime('2026-10-20T15:10:00Z')).toBe('20/10/2026 18:10')
    // late UTC evening is already the next day in Cairo
    expect(dmy('2026-10-20T22:30:00Z')).toBe('21/10/2026')
  })
  it('empty / bad values', () => {
    expect(dmy(null)).toBe('—')
    expect(dmyTime('nope')).toBe('—')
  })
})
