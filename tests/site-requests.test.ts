import { describe, it, expect } from 'vitest'
import { mergeContent } from '@/lib/site/content-merge'
import { SITE_CONTENT } from '@/lib/site/content'
import { normalizePhone, websiteRequestSchema } from '@/lib/site/request-rules'

describe('x01 website content saved from the system', () => {
  it('saved texts win, keys missing from the save keep their default', () => {
    const merged = mergeContent(SITE_CONTENT, { hero: { title1: { en: 'Hello', ar: 'أهلاً' } }, contact: { whatsapp: '01012345678' } })
    expect(merged.hero.title1.ar).toBe('أهلاً')
    expect(merged.hero.title2).toEqual(SITE_CONTENT.hero.title2)
    expect(merged.contact.whatsapp).toBe('01012345678')
    expect(merged.solutions.items.length).toBe(SITE_CONTENT.solutions.items.length)
  })

  it('lists come from the save (items added, removed, reordered) and a hidden section stays hidden', () => {
    const merged = mergeContent(SITE_CONTENT, { why: { show: false, items: [{ title: { en: 'A', ar: 'أ' }, text: { en: 'x', ar: 'س' } }] } })
    expect(merged.why.show).toBe(false)
    expect(merged.why.items).toHaveLength(1)
  })

  it('a value of the wrong type falls back to the default, unknown keys are dropped', () => {
    const merged = mergeContent(SITE_CONTENT, { hero: { title1: 5, hacker: '<script>' }, cta: 'oops' }) as unknown as Record<string, Record<string, unknown>>
    expect(merged.hero.title1).toEqual(SITE_CONTENT.hero.title1)
    expect('hacker' in merged.hero).toBe(false)
    expect(merged.cta).toEqual(SITE_CONTENT.cta)
  })
})

describe('x01 website forms', () => {
  it('phones: Egyptian mobiles, international numbers and Arabic digits', () => {
    expect(normalizePhone('010 1234 5678')).toBe('01012345678')
    expect(normalizePhone('٠١٠١٢٣٤٥٦٧٨')).toBe('01012345678')
    expect(normalizePhone('+4915112345678')).toBe('+4915112345678')
    expect(normalizePhone('004915112345678')).toBe('+4915112345678')
    expect(normalizePhone('12345')).toBeNull()
  })

  it('a school / solution / partnership request needs the organisation; a contact message does not', () => {
    expect(websiteRequestSchema.safeParse({ kind: 'SCHOOL', name: 'Mona', phone: '01012345678' }).success).toBe(false)
    expect(websiteRequestSchema.safeParse({ kind: 'SCHOOL', name: 'Mona', phone: '01012345678', organisation: 'Nile School' }).success).toBe(true)
    expect(websiteRequestSchema.safeParse({ kind: 'CONTACT', name: 'Mona', phone: '01012345678' }).success).toBe(true)
    expect(websiteRequestSchema.safeParse({ kind: 'CONTACT', name: 'Mona', phone: '123' }).success).toBe(false)
    expect(websiteRequestSchema.safeParse({ kind: 'HACK', name: 'Mona', phone: '01012345678' }).success).toBe(false)
  })
})
