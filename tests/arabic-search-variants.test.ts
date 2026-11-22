import { describe, expect, it } from 'vitest'
import { arabicVariants, studentNameMatch } from '@/lib/students/name-search'

describe('Arabic name search (final test X04)', () => {
  it('alef with and without hamza / madda', () => {
    expect(arabicVariants('ادم')).toContain('آدم')
    expect(arabicVariants('آدم')).toContain('ادم')
    expect(arabicVariants('احمد')).toContain('أحمد')
    expect(arabicVariants('أحمد')).toContain('احمد')
  })
  it('ta marbuta / ha and alef maksura / ya', () => {
    expect(arabicVariants('فاطمه')).toContain('فاطمة')
    expect(arabicVariants('فاطمة')).toContain('فاطمه')
    expect(arabicVariants('مصطفي')).toContain('مصطفى')
  })
  it('the typed text comes first, nothing changes for letters without a twin', () => {
    expect(arabicVariants('مريم')[0]).toBe('مريم')
    expect(arabicVariants('Ahmed')).toEqual(['Ahmed'])
  })
  it('never explodes: a long word with many alefs stays capped', () => {
    expect(arabicVariants('اااااااااااااااا').length).toBeLessThanOrEqual(24)
  })
  it('the database condition covers every spelling in every name field', () => {
    const c = studentNameMatch('فاطمه')
    expect(c.length).toBe(arabicVariants('فاطمه').length * 5)
    expect(c.some((x) => JSON.stringify(x).includes('فاطمة'))).toBe(true)
  })
})
