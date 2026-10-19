import { describe, expect, it } from 'vitest'
import { dmyToIso, isoToDmy } from '@/components/ui/date-input'

describe('dates as day / month / year (2026-10-19)', () => {
  it('shows YYYY-MM-DD as dd/mm/yyyy', () => {
    expect(isoToDmy('2026-10-19')).toBe('19/10/2026')
    expect(isoToDmy('')).toBe('')
  })
  it('reads dd/mm/yyyy (also with - or . or Arabic digits) and refuses impossible dates', () => {
    expect(dmyToIso('19/10/2026')).toBe('2026-10-19')
    expect(dmyToIso('1-2-2026')).toBe('2026-02-01')
    expect(dmyToIso('١٩/١٠/٢٠٢٦')).toBe('2026-10-19')
    expect(dmyToIso('31/02/2026')).toBeNull()
    expect(dmyToIso('10/19/2026')).toBeNull()
  })
})
