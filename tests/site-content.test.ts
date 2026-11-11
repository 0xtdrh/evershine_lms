import { describe, it, expect } from 'vitest'
import { SITE_CONTENT, visible } from '@/lib/site/content'
import { shownStats } from '@/lib/site/stats-shared'

describe('x01 website content', () => {
  it('examples show only in the preview, hidden items never', () => {
    const items = [{ id: 1 }, { id: 2, sample: true }, { id: 3, show: false }]
    expect(visible(items, true).map((i) => i.id)).toEqual([1, 2])
    expect(visible(items, false).map((i) => i.id)).toEqual([1])
  })

  it('the real site shows no invented project, product, event or news', () => {
    for (const list of [SITE_CONTENT.achievements.items, SITE_CONTENT.products.items, SITE_CONTENT.events.items, SITE_CONTENT.media.items]) {
      expect(visible(list, false)).toEqual([])
    }
  })

  it('numbers: a live number under its minimum is left out, a fixed one always shows', () => {
    const items = [{ source: 'students' as const, min: 50 }, { source: 'sessions' as const, min: 10 }, { value: 4 }, { value: 9, show: false }]
    expect(shownStats(items, { students: 20, sessions: 300, certificates: 0, partnerPlaces: 0, branches: 1 })).toEqual([{ i: 1, value: 300 }, { i: 2, value: 4 }])
    expect(shownStats(items, null)).toEqual([{ i: 2, value: 4 }])
  })

  it('every text has both languages', () => {
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk)
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>
        if ('en' in o || 'ar' in o) { expect(String(o.en ?? '').length).toBeGreaterThan(0); expect(String(o.ar ?? '').length).toBeGreaterThan(0) }
        Object.values(o).forEach(walk)
      }
    }
    walk(SITE_CONTENT)
  })
})
