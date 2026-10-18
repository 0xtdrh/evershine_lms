import { describe, expect, it } from 'vitest'
import { applyPing, summarize } from '@/lib/activity/usage'

const t = (iso: string) => new Date(`2026-10-18T${iso}:00.000Z`)

describe('usage tracking (2026-10-18)', () => {
  it('first ping = a visit; pings a minute apart add active time; a long gap starts a new visit', () => {
    expect(applyPing(null, t('10:00'))).toEqual({ newVisit: true, addSeconds: 0 })
    expect(applyPing(t('10:00'), t('10:01'))).toEqual({ newVisit: false, addSeconds: 60 })
    expect(applyPing(t('10:00'), t('10:10'))).toEqual({ newVisit: false, addSeconds: 120 })
    expect(applyPing(t('10:00'), t('10:45'))).toEqual({ newVisit: true, addSeconds: 0 })
  })
  it('totals and average visit length', () => {
    const s = summarize([{ visits: 2, activeSeconds: 1200, logins: 1, lastAt: t('11:00') }, { visits: 1, activeSeconds: 600, logins: 0, lastAt: t('20:00') }])
    expect([s.visits, s.activeSeconds, s.logins, s.days, s.avgVisitMin, s.lastAt?.toISOString()]).toEqual([3, 1800, 1, 2, 10, t('20:00').toISOString()])
  })
})
