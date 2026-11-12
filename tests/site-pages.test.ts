import { describe, it, expect } from 'vitest'
import { PAGES, PAGE_SECTIONS, isSitePath, pageHref, pageOf, slugify } from '@/lib/site/pages'
import { SITE_CONTENT } from '@/lib/site/content'

describe('x01 website pages', () => {
  it('the old one-page links open the pages', () => {
    expect(pageHref('#education')).toBe('/education')
    expect(pageHref('#schools')).toBe('/education#schools')
    expect(pageHref('#top')).toBe('/new-home')
    expect(pageHref('https://example.com')).toBe('https://example.com')
    expect(pageOf('#solutions')).toBe('solutions')
  })
  it('every menu item opens a page, and every page shows at least one section', () => {
    for (const n of SITE_CONTENT.nav) expect(pageHref(n.href).startsWith('/')).toBe(true)
    for (const p of PAGES) expect(PAGE_SECTIONS[p].length).toBeGreaterThan(0)
  })
  it('solution links are stable and unique', () => {
    const slugs = SITE_CONTENT.solutions.items.map((s) => slugify(s.title.en))
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(slugify('Smart hotels & resorts')).toBe('smart-hotels-and-resorts')
  })
  it('the preview lock covers the website pages but never a certificate check link', () => {
    expect(isSitePath('/about')).toBe(true)
    expect(isSitePath('/solutions/smart-hotels-and-resorts')).toBe(true)
    expect(isSitePath('/verify')).toBe(true)
    expect(isSitePath('/verify/TN-CERT-2026-00001')).toBe(false)
    expect(isSitePath('/dashboard')).toBe(false)
  })
})
