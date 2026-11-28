import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FIELDS, DEFAULT_SEASONS, FIELD_KEYS, editionNumber, isMonthDay, learningHours, mrzLines, normalizeFields, passportEdition, placeLabel, sealSvg, seasonDates,
} from '@/lib/passport/book'

describe('passport book (owner 28/11, S49)', () => {
  it('fields: old settings get the defaults; share link hides age and school by default', () => {
    const f = normalizeFields(undefined)
    expect(Object.keys(f).sort()).toEqual([...FIELD_KEYS].sort())
    expect(f.age).toEqual({ passport: true, share: false })
    expect(f.school.share).toBe(false)
    expect(normalizeFields({ age: { share: true }, junk: 1 }).age).toEqual({ passport: true, share: true })
    expect(normalizeFields({ age: { passport: 'yes' } }).age.passport).toBe(DEFAULT_FIELDS.age.passport)
  })

  it('seasons: valid month-days, Christmas first, moving ones marked', () => {
    expect(DEFAULT_SEASONS.every((s) => isMonthDay(s.from) && isMonthDay(s.to))).toBe(true)
    expect(DEFAULT_SEASONS[0].ar).toBe('عيد الميلاد المجيد')
    expect(DEFAULT_SEASONS.find((s) => s.en === 'Ramadan')?.moves).toBe(true)
    expect(isMonthDay('13-01')).toBe(false)
    expect(isMonthDay('02-30')).toBe(true) // the stamp date input checks the real day
    expect(seasonDates({ from: '12-20', to: '01-05' }, 2026)).toEqual({ from: '2026-12-20', to: '2027-01-05' })
    expect(seasonDates({ from: '07-01', to: '08-31' }, 2026)).toEqual({ from: '2026-07-01', to: '2026-08-31' })
  })

  it('renewal: a new passport every N stamps, the old ones stay', () => {
    expect(passportEdition(0, 24)).toMatchObject({ edition: 1, onThisBook: 0, justRenewed: false })
    expect(passportEdition(24, 24)).toMatchObject({ edition: 1, onThisBook: 24 })
    expect(passportEdition(25, 24)).toMatchObject({ edition: 2, onThisBook: 1, justRenewed: true })
    expect(passportEdition(30, 24)).toMatchObject({ edition: 2, onThisBook: 6, justRenewed: false })
    expect(passportEdition(10, 2).perBook).toBe(6) // never fewer than 6 per book
    expect(editionNumber('TN-PASS-2026-0012', 1)).toBe('TN-PASS-2026-0012')
    expect(editionNumber('TN-PASS-2026-0012', 3)).toBe('TN-PASS-2026-0012-3')
  })

  it('place: branch by name, partner school, online', () => {
    expect(placeLabel({ name: 'Dahar', kind: 'MAIN', online: false }, true)).toBe('Dahar')
    expect(placeLabel({ name: 'مدرسة النيل', kind: 'PARTNER', online: false }, true)).toBe('مدرسة النيل · شريك')
    expect(placeLabel({ name: 'Dahar', kind: 'MAIN', online: true }, true)).toBe('أونلاين')
    expect(placeLabel({ name: 'x', kind: 'ONLINE', online: false }, false)).toBe('Online')
    expect(placeLabel(null, true)).toBe('')
  })

  it('learning hours: each group its own length, else the default', () => {
    expect(learningHours([{ minutes: 90 }, { minutes: 90 }, { minutes: null }], 60)).toBe(4)
    expect(learningHours([], 60)).toBe(0)
  })

  it('machine lines: 30 characters, Latin only, never breaks on Arabic', () => {
    const [a, b] = mrzLines('Youssef Ahmed Ali', 'TN-PASS-2026-0012', '2026-03-05T00:00:00Z')
    expect(a).toHaveLength(30); expect(b).toHaveLength(30)
    expect(a.startsWith('P<TNVAHMED<ALI<<YOUSSEF')).toBe(true)
    expect(b.startsWith('TNPASS20260012<260305<')).toBe(true)
    const [c, d] = mrzLines('يوسف السيد', 'TN-PASS-2026-0001', null)
    expect(c.startsWith('P<TNVALSYD<<YOSF')).toBe(true) // Arabic names in rough Latin letters
    expect(c).toMatch(/^[A-Z0-9<]{30}$/)
    expect(d).toContain('<000000<')
  })

  it('seal: escapes text, mono for the stamp maker, only colour codes', () => {
    const svg = sealSvg({ top: '<script>', bottom: 'تكنوفا', mono: true })
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('#000000')
    expect(svg).toContain('تكنوفا')
    expect(sealSvg({ top: 'A', bottom: 'B', color: 'red;x' })).toContain('#0B3A5B')
  })
})
