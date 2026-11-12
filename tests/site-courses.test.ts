import { describe, it, expect } from 'vitest'
import { AGE_BANDS, DEFAULT_SECTIONS, ageText, fitsAge, fitsBand, fromPrice, listable, listingSchema, sectionOn, slugFrom } from '@/lib/site/courses'
import { isSitePath, pageHref } from '@/lib/site/pages'

describe('six phases 1-a: course listings', () => {
  it('a section follows the course switch first, then the company default', () => {
    expect(sectionOn('sessions', {}, DEFAULT_SECTIONS)).toBe(false)
    expect(sectionOn('sessions', { sessions: { show: true } }, DEFAULT_SECTIONS)).toBe(true)
    expect(sectionOn('faq', { faq: { show: null, items: [] } }, { ...DEFAULT_SECTIONS, faq: false })).toBe(false)
    expect(sectionOn('price', { price: { show: false } })).toBe(false)
  })
  it('a course inside a track shows alone only when it is sold alone', () => {
    expect(listable({ refType: 'TRACK', show: true, soldAlone: false }, false)).toBe(true)
    expect(listable({ refType: 'COURSE', show: true, soldAlone: false }, true)).toBe(false)
    expect(listable({ refType: 'COURSE', show: true, soldAlone: true }, true)).toBe(true)
    expect(listable({ refType: 'COURSE', show: true, soldAlone: false }, false)).toBe(true)
    expect(listable({ refType: 'TRACK', show: false, soldAlone: true }, false)).toBe(false)
  })
  it('age filter, link names, validation', () => {
    expect(fitsAge(9, 8, 10)).toBe(true)
    expect(fitsAge(12, 8, 10)).toBe(false)
    expect(fitsAge(30, 18, null)).toBe(true)
    expect(slugFrom('Nova Builders & AI')).toBe('nova-builders-and-ai')
    expect(listingSchema.safeParse({ refType: 'TRACK', refId: 'x', slug: 'nova-builders' }).success).toBe(true)
    expect(listingSchema.safeParse({ refType: 'TRACK', refId: 'x', slug: 'Nova Builders' }).success).toBe(false)
    expect(listingSchema.safeParse({ refType: 'TRACK', refId: 'x', slug: 'ok-slug', sections: { preview: { videoUrl: 'javascript:x' } } }).success).toBe(false)
  })
  it('the courses pages are part of the website', () => {
    expect(pageHref('#courses')).toBe('/courses')
    expect(isSitePath('/courses')).toBe(true)
    expect(isSitePath('/courses/nova-builders')).toBe(true)
  })
  it('courses page v2: ages in words, age bands overlap, lowest price', () => {
    expect(ageText(4, 7, true)).toBe('من 4 لحد 7 سنين')
    expect(ageText(18, null, true)).toBe('من 18 سنة وأكبر')
    expect(ageText(4, 7, false)).toBe('Ages 4–7')
    expect(ageText(null, null, true)).toBe('')
    const b = (k: string) => AGE_BANDS.find((x) => x.key === k)!
    expect(fitsBand({ minAge: 8, maxAge: 10 }, b('8-10'))).toBe(true)
    expect(fitsBand({ minAge: 11, maxAge: 14 }, b('8-10'))).toBe(false)
    expect(fitsBand({ minAge: 15, maxAge: null }, b('18'))).toBe(true)
    expect(fitsBand({ minAge: null, maxAge: null }, b('4-7'))).toBe(true)
    expect(fromPrice({ online: 900, recorded: 600 }, true)).toBe(600)
    expect(fromPrice({ online: 900, recorded: null }, false)).toBeNull()
  })
})
