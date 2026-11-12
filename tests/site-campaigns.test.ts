import { describe, it, expect } from 'vitest'
import { campaignSchema, campaignState } from '@/lib/site/campaigns'
import { adSources, firstSourcePerStudent } from '@/lib/business/ad-calc'

describe('x01 campaign pages', () => {
  it('state by Cairo day: hidden, not started, live (both ends included), ended', () => {
    const c = { show: true, startsAt: '2026-12-01', endsAt: '2026-12-10' }
    expect(campaignState({ ...c, show: false }, '2026-12-05')).toBe('HIDDEN')
    expect(campaignState(c, '2026-11-30')).toBe('UPCOMING')
    expect(campaignState(c, '2026-12-01')).toBe('LIVE')
    expect(campaignState(c, '2026-12-10')).toBe('LIVE')
    expect(campaignState(c, '2026-12-11')).toBe('ENDED')
    expect(campaignState({ show: true }, '2030-01-01')).toBe('LIVE')
  })
  it('link names are simple; the end cannot be before the start', () => {
    expect(campaignSchema.safeParse({ slug: 'winter-camp', titleEn: 'Winter', titleAr: '' }).success).toBe(true)
    expect(campaignSchema.safeParse({ slug: 'Winter Camp!', titleEn: 'Winter', titleAr: '' }).success).toBe(false)
    expect(campaignSchema.safeParse({ slug: 'winter-camp', titleEn: 'W', titleAr: '', startsAt: '2026-12-10', endsAt: '2026-12-01' }).success).toBe(false)
  })
})

describe('x01 cost per request / new student by ad source', () => {
  it('a student counts once, for the source of the first request', () => {
    const m = firstSourcePerStudent([
      { studentId: 's1', source: 'INSTAGRAM', at: new Date('2026-11-05') },
      { studentId: 's1', source: 'FACEBOOK', at: new Date('2026-11-02') },
      { studentId: 's2', source: 'GOOGLE', at: new Date('2026-11-03') },
    ])
    expect([...m.entries()]).toEqual([['s1', 'FACEBOOK'], ['s2', 'GOOGLE']])
  })
  it('cost per request and per new student; no spend or nothing gained = no cost', () => {
    const r = adSources({ spend: { FACEBOOK: 3000 }, visits: { FACEBOOK: 400 }, requests: { FACEBOOK: 10, GOOGLE: 2 }, studentSource: new Map([['s1', 'FACEBOOK'], ['s2', 'FACEBOOK'], ['s3', 'GOOGLE']]), newStudentsTotal: 7 })
    const fb = r.rows.find((x) => x.source === 'FACEBOOK')!
    expect(fb).toMatchObject({ spend: 3000, requests: 10, newStudents: 2, costPerRequest: 300, costPerNew: 1500 })
    expect(r.rows.find((x) => x.source === 'GOOGLE')).toMatchObject({ costPerRequest: null, costPerNew: null })
    expect(r.totals).toMatchObject({ spend: 3000, newFromWebsite: 3, newOther: 4, costPerNewAll: 428.57 })
  })
})
