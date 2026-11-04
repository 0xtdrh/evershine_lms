import { describe, expect, it } from 'vitest'
import { accessState, certificateReady, extendAccess, lessonsUsed, lockMessage, planOffer, progressPct } from '@/lib/recorded/rules'

const at = (s: string) => new Date(s)

describe('recorded course access', () => {
  const now = at('2026-11-02T10:00:00Z')
  it('nothing paid = closed', () => {
    expect(accessState({ plan: 'SUBSCRIPTION', endsAt: null, applied: 0 }, now)).toBe('NOT_PAID')
    expect(accessState({ plan: 'ONE_TIME', endsAt: null, applied: 0 }, now)).toBe('NOT_PAID')
  })
  it('a one-time purchase never ends', () => {
    expect(accessState({ plan: 'ONE_TIME', endsAt: null, applied: 1 }, now)).toBe('OPEN')
  })
  it('a subscription is open until its end', () => {
    expect(accessState({ plan: 'SUBSCRIPTION', endsAt: at('2026-11-03T00:00:00Z'), applied: 1 }, now)).toBe('OPEN')
    expect(accessState({ plan: 'SUBSCRIPTION', endsAt: at('2026-11-02T10:00:00Z'), applied: 1 }, now)).toBe('EXPIRED')
  })
  it('days run from the payment, or on from the end when renewed early', () => {
    expect(extendAccess(null, now, 30).toISOString()).toBe('2026-12-02T10:00:00.000Z')
    expect(extendAccess(at('2026-11-01T00:00:00Z'), now, 30).toISOString()).toBe('2026-12-02T10:00:00.000Z')
    expect(extendAccess(at('2026-11-10T10:00:00Z'), now, 30).toISOString()).toBe('2026-12-10T10:00:00.000Z')
  })
  it('only a closed course has a message', () => {
    expect(lockMessage('OPEN')).toBeNull()
    expect(lockMessage('NOT_PAID')?.ar).toContain('تتدفع')
    expect(lockMessage('EXPIRED')?.ar).toContain('محفوظ')
  })
})

describe('recorded course certificate', () => {
  const base = { done: 5, total: 5, examRequired: true, hasExam: true, examScore: 70, passMark: 60 }
  it('needs every lesson', () => {
    expect(certificateReady({ ...base, done: 4 })).toBe(false)
    expect(certificateReady({ ...base, done: 0, total: 0, examRequired: false })).toBe(false)
  })
  it('needs the exam passed when asked', () => {
    expect(certificateReady(base)).toBe(true)
    expect(certificateReady({ ...base, examScore: 59.9 })).toBe(false)
    expect(certificateReady({ ...base, examScore: null })).toBe(false)
    expect(certificateReady({ ...base, hasExam: false, examScore: null })).toBe(false)
  })
  it('the pass mark defaults to 50', () => {
    expect(certificateReady({ ...base, examScore: 50, passMark: null })).toBe(true)
  })
  it('without the exam rule the lessons are enough', () => {
    expect(certificateReady({ ...base, examRequired: false, hasExam: false, examScore: null })).toBe(true)
  })
})

describe('recorded course offer', () => {
  const c = { subscriptionPrice: 300, subscriptionDays: 30, oneTimePrice: null }
  it('gives the plan the course sells', () => {
    expect(planOffer(c, 'SUBSCRIPTION')).toEqual({ price: 300, days: 30 })
    expect(planOffer(c, 'ONE_TIME')).toBeNull()
    expect(planOffer({ ...c, oneTimePrice: 0 }, 'ONE_TIME')).toEqual({ price: 0, days: null })
    expect(planOffer({ ...c, subscriptionDays: null }, 'SUBSCRIPTION')).toBeNull()
  })
  it('percent', () => {
    expect(progressPct(1, 3)).toBe(33)
    expect(progressPct(0, 0)).toBe(0)
  })
})

describe('lessons taken off a refund', () => {
  const now = at('2026-11-03T10:00:00Z')
  const base = { opened: 1, total: 4, plan: 'SUBSCRIPTION', cycle: 1, applied: 1, endsAt: at('2026-11-20T00:00:00Z') }
  it('counts the lessons opened', () => {
    expect(lessonsUsed(base, now)).toBe(1)
    expect(lessonsUsed({ ...base, opened: 9 }, now)).toBe(4)
  })
  it('a period that is over counts as all of them', () => {
    expect(lessonsUsed({ ...base, endsAt: at('2026-11-01T00:00:00Z') }, now)).toBe(4)
    expect(lessonsUsed({ ...base, applied: 2 }, now)).toBe(4)
  })
  it('a one-time purchase only counts what was opened', () => {
    expect(lessonsUsed({ ...base, plan: 'ONE_TIME', endsAt: null }, now)).toBe(1)
  })
})
