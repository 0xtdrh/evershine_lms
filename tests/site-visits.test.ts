import { describe, it, expect } from 'vitest'
import { classifySource, deviceOf, isBot, isBounce } from '@/lib/site/visit-rules'
import { lastDays, summarize, type VisitRow } from '@/lib/site/analytics-calc'

describe('x01 visitors: where they came from', () => {
  it('a campaign link wins; known networks keep their name', () => {
    expect(classifySource('https://www.google.com/', 'facebook')).toBe('FACEBOOK')
    expect(classifySource(null, 'ig_story')).toBe('INSTAGRAM')
    expect(classifySource(null, 'flyer-qr')).toBe('CAMPAIGN')
  })
  it('the referring site, else direct (our own site counts as direct)', () => {
    expect(classifySource('https://www.google.com.eg/search?q=robotics', null)).toBe('GOOGLE')
    expect(classifySource('https://l.facebook.com/l.php?u=x', null)).toBe('FACEBOOK')
    expect(classifySource('https://l.instagram.com/', null)).toBe('INSTAGRAM')
    expect(classifySource('https://www.bing.com/', null)).toBe('OTHER_SEARCH')
    expect(classifySource('https://someblog.example/post', null)).toBe('REFERRAL')
    expect(classifySource('', null)).toBe('DIRECT')
    expect(classifySource('https://technova.example/new-home', null, 'technova.example')).toBe('DIRECT')
  })
  it('device and bots', () => {
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe('MOBILE')
    expect(deviceOf('Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 Safari/537.36')).toBe('TABLET')
    expect(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130')).toBe('DESKTOP')
    expect(isBot('Googlebot/2.1')).toBe(true)
    expect(isBot('facebookexternalhit/1.1')).toBe(true)
    expect(isBot(null)).toBe(true)
    expect(isBot('Mozilla/5.0 (Windows NT 10.0) Chrome/130')).toBe(false)
  })
})

describe('x01 visitors: the numbers', () => {
  const at = (iso: string) => new Date(iso)
  const v = (o: Partial<VisitRow>): VisitRow => ({ sessionId: Math.random().toString(36).slice(2), visitorId: null, startedAt: at('2026-11-10T10:00:00Z'), seconds: 60, pages: 2, landing: '/new-home', source: 'GOOGLE', device: 'MOBILE', city: null, utmCampaign: null, converted: false, ...o })

  it('totals, bounce, conversion, unique visitors, days in Cairo time', () => {
    const rows = [
      v({ sessionId: 'a', visitorId: 'p1', converted: true }),
      v({ sessionId: 'b', visitorId: 'p1', seconds: 5, pages: 1 }),
      v({ sessionId: 'c', source: 'FACEBOOK', startedAt: at('2026-11-10T22:30:00Z') }), // 00:30 on the 11th in Cairo
    ]
    const s = summarize(rows, [{ sessionId: 'a', kind: 'FORM_SENT', label: 'SCHOOL:education' }, { sessionId: 'a', kind: 'FORM_OPEN', label: 'SCHOOL:education' }], [{ kind: 'SCHOOL', visitSessionId: 'a' }, { kind: 'CONTACT', visitSessionId: null }], ['2026-11-10', '2026-11-11'])
    expect(s.totals.visits).toBe(3)
    expect(s.totals.visitors).toBe(2)
    expect(s.totals.bounceRate).toBe(33.3)
    expect(s.totals.conversionRate).toBe(33.3)
    expect(s.totals.requestsTracked).toBe(1)
    expect(s.byDay).toEqual([{ day: '2026-11-10', visits: 2 }, { day: '2026-11-11', visits: 1 }])
    expect(s.bySource.find((x) => x.key === 'GOOGLE')).toMatchObject({ count: 2, converted: 1, requests: 1 })
    expect(s.forms.byKind).toEqual([{ key: 'SCHOOL', count: 1, sent: 1 }])
  })
  it('a bounce is one page under 15 seconds; the day list ends today', () => {
    expect(isBounce({ pages: 1, seconds: 10 })).toBe(true)
    expect(isBounce({ pages: 2, seconds: 10 })).toBe(false)
    expect(lastDays(3, at('2026-11-11T08:00:00Z'))).toEqual(['2026-11-09', '2026-11-10', '2026-11-11'])
  })
})
