import { describe, expect, it } from 'vitest'
import { cardState, firstStudentCode, mirroredBacks, nextCode, normalizeCardCode, sheets, staffBaseCode, validUntil } from '@/lib/cards/rules'

describe('ID cards (2026-10-19)', () => {
  it('scanned link or raw code → code', () => {
    expect(normalizeCardCode('https://x.app/card/TN-QR-TN-2026-0001')).toBe('TN-QR-TN-2026-0001')
    expect(normalizeCardCode(' TN-QR-TN-2026-0001 ')).toBe('TN-QR-TN-2026-0001')
  })
  it('codes: first, replacements, staff', () => {
    expect(firstStudentCode('TN/2026/0001')).toBe('TN-QR-TN-2026-0001')
    expect(nextCode('TN-QR-TN-2026-0001', 'x')).toBe('TN-QR-TN-2026-0001-R2')
    expect(nextCode('TN-QR-TN-2026-0001-R2', 'x')).toBe('TN-QR-TN-2026-0001-R3')
    expect(nextCode(null, 'TN-STF-E7')).toBe('TN-STF-E7-R2')
    expect(staffBaseCode('emp 7/a')).toBe('TN-STF-EMP-7-A')
  })
  it('valid / expired / left', () => {
    const now = new Date('2026-10-19T00:00:00Z')
    expect(validUntil(new Date('2026-01-31T00:00:00Z'), 12).toISOString().slice(0, 10)).toBe('2027-01-31')
    expect(cardState({ found: true, active: true, expiresAt: new Date('2027-01-01'), now })).toBe('VALID')
    expect(cardState({ found: true, active: true, expiresAt: new Date('2026-01-01'), now })).toBe('EXPIRED')
    expect(cardState({ found: true, active: false, expiresAt: null, now })).toBe('LEFT')
    expect(cardState({ found: false, active: false, expiresAt: null, now })).toBe('UNKNOWN')
  })
  it('10 per A4 sheet; backs mirrored per row for duplex', () => {
    expect(sheets([...Array(23).keys()]).map((s) => s.length)).toEqual([10, 10, 3])
    expect(mirroredBacks([1, 2, 3])).toEqual([2, 1, null, 3, null, null, null, null, null, null])
  })
})
