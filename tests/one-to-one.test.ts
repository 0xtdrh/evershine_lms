import { describe, expect, it } from 'vitest'
import { levelFinished, nameFor, pickPrice, quote, type PriceRow } from '@/lib/one-to-one/rules'
import { sessionRate } from '@/lib/teachers/online-pay'
import { sessionsPerCycle } from '@/lib/groups/cycle-rules'
import { overlapsBy } from '@/lib/rooms/rules'
import { teachClash } from '@/lib/teachers/work-hours'
import { refundWindowOpen } from '@/lib/refunds/engine'
import { cleanLocks, transferLockReason } from '@/lib/groups/transfer-lock'
import { mergeOneToOne } from '@/lib/partners/deal'
import { canCarryNow, carryCount, cleanOneToOneSettings, holdOver, nextCandidate, noShowDays, postponeProblem, suggestParentPresent } from '@/lib/one-to-one/request-rules'

const r = (over: Partial<PriceRow>): PriceRow => ({ levelId: 'L', scopeKey: 'ALL', plan: 'MONTH', sessions: 4, price: 1000, siblingPrice: null, minutes: null, ...over })

describe('One-to-One (a02 M3)', () => {
  it('a price for the place wins over the price for everywhere', () => {
    const rows = [r({ price: 1000 }), r({ scopeKey: 'C1', price: 1200 })]
    expect(pickPrice(rows, 'C1', 'MONTH', 4)?.price).toBe(1200)
    expect(pickPrice(rows, 'C2', 'MONTH', 4)?.price).toBe(1000)
    expect(pickPrice(rows, 'C1', 'PACKAGE', 8)).toBeNull()
  })
  it('a package is picked by its size; a session price fits any number of sessions', () => {
    const rows = [r({ plan: 'PACKAGE', sessions: 8, price: 1800 }), r({ plan: 'PACKAGE', sessions: 12, price: 2500 }), r({ plan: 'SESSION', sessions: 1, price: 300 })]
    expect(pickPrice(rows, 'C', 'PACKAGE', 12)?.price).toBe(2500)
    expect(pickPrice(rows, 'C', 'SESSION', null)?.price).toBe(300)
  })
  it('what each student pays: month / package as written, sessions × the session price', () => {
    expect(quote(r({ plan: 'PACKAGE', sessions: 8, price: 1800 }), 99, false)).toEqual({ amount: 1800, sessions: 8 })
    expect(quote(r({ plan: 'SESSION', sessions: 1, price: 300 }), 3, false)).toEqual({ amount: 900, sessions: 3 })
  })
  it('two siblings in one session pay the sibling price each; no sibling price = the normal price', () => {
    expect(quote(r({ siblingPrice: 700 }), null, true).amount).toBe(700)
    expect(quote(r({ plan: 'SESSION', sessions: 1, price: 300, siblingPrice: 200 }), 4, true)).toEqual({ amount: 800, sessions: 4 })
    expect(quote(r({}), null, true).amount).toBe(1000)
  })
  it('the name fits a group name and says who', () => {
    expect(nameFor([{ firstName: 'Ahmed', lastName: 'Ali' }], 'Arduino 1')).toBe('Ahmed Ali — Arduino 1')
    expect(nameFor([{ firstName: 'Ahmed', lastName: 'Ali' }, { firstName: 'Omar', lastName: 'Ali' }], 'Arduino 1')).toBe('Ahmed & Omar Ali — Arduino 1')
    expect(nameFor([{ firstName: 'A'.repeat(40), lastName: 'B'.repeat(40) }], 'L').length).toBe(50)
  })
  it('a level finishes by its sessions, whatever the plan', () => {
    expect(levelFinished(1, 8, 8)).toBe(true)
    expect(levelFinished(1, 4, 8)).toBe(false)
    expect(levelFinished(2, 4, 8)).toBe(true)
    expect(levelFinished(7, 1, 8)).toBe(false)
  })
  it('the sessions of a cycle: its own number wins over the level', () => {
    const level = { numberOfSessions: 8, numberOfMonths: 2, pricingType: 'MONTHLY' }
    expect(sessionsPerCycle(level)).toBe(4)
    expect(sessionsPerCycle(level, 3)).toBe(3)
    expect(sessionsPerCycle(level, null)).toBe(4)
  })
  it('instructor rate: One-to-One rate first, empty = as usual; recorded is never paid per session', () => {
    const rule = { fixed: null, percent: null, perSession: 100, onlinePerSession: 80, oneToOnePerSession: 150 }
    expect(sessionRate(rule, 'BRANCH', true)).toBe(150)
    expect(sessionRate(rule, 'ONLINE', true)).toBe(150)
    expect(sessionRate(rule, 'RECORDED', true)).toBeNull()
    expect(sessionRate(rule, 'BRANCH', false)).toBe(100)
    expect(sessionRate({ ...rule, oneToOnePerSession: null }, 'ONLINE', true)).toBe(80)
  })
  it('the next instructor: the one the parent prefers, never someone who passed', () => {
    expect(nextCandidate(['a', 'b', 'c'], [], null)).toBe('a')
    expect(nextCandidate(['a', 'b', 'c'], ['a'], null)).toBe('b')
    expect(nextCandidate(['a', 'b', 'c'], [], 'c')).toBe('c')
    expect(nextCandidate(['a', 'b'], ['b'], 'b')).toBe('a')
    expect(nextCandidate(['a'], ['a'], null)).toBeNull()
    expect(nextCandidate([], [], null)).toBeNull()
  })
  it('settings stay in range; missing ones take the default', () => {
    expect(cleanOneToOneSettings({})).toMatchObject({ portalOpen: true, assignWithoutAsking: false, replyHours: 12, parentPresentUnderAge: 7 })
    expect(cleanOneToOneSettings({ replyHours: 0 }).replyHours).toBe(1)
    expect(cleanOneToOneSettings({ replyHours: 9999 }).replyHours).toBe(168)
  })
  it('suggest a parent stays: young child, online only, age known', () => {
    expect(suggestParentPresent(5, [{ mode: 'ONLINE' }], 7)).toBe(true)
    expect(suggestParentPresent(5, [{ mode: 'BRANCH' }], 7)).toBe(false)
    expect(suggestParentPresent(9, [{ mode: 'ONLINE' }], 7)).toBe(false)
    expect(suggestParentPresent(null, [{ mode: 'ONLINE' }], 7)).toBe(false)
  })
  it('refund until N days before the first session: closed once started', () => {
    const slots = [{ dayOfWeek: 4 }] // Thursday; 2026-11-01 is a Sunday: 4 days away
    expect(refundWindowOpen({ until: null, started: true, slots, today: '2026-11-01' })).toBe(true)
    expect(refundWindowOpen({ until: 4, started: false, slots, today: '2026-11-01' })).toBe(true)
    expect(refundWindowOpen({ until: 5, started: false, slots, today: '2026-11-01' })).toBe(false)
    expect(refundWindowOpen({ until: 0, started: true, slots, today: '2026-11-01' })).toBe(false)
    expect(refundWindowOpen({ until: 3, started: false, slots: [], today: '2026-11-01' })).toBe(true)
  })
  it('moves can be closed by system, place or partner; either side of the move counts', () => {
    const one = { kind: 'ONE_TO_ONE', mode: 'BRANCH', campusId: 'c1', partnerId: null }
    const grp = { kind: 'GROUP', mode: 'BRANCH', campusId: 'c2', partnerId: 'p1' }
    expect(transferLockReason(cleanLocks({}), one, grp)).toBeNull()
    expect(transferLockReason(cleanLocks({ all: true }), one, grp)).toBeTruthy()
    expect(transferLockReason(cleanLocks({ kinds: ['ONE_TO_ONE'] }), grp, one)).toBeTruthy()
    expect(transferLockReason(cleanLocks({ campusIds: ['c2'] }), one, grp)).toBeTruthy()
    expect(transferLockReason(cleanLocks({ partnerIds: ['p1'] }), one, grp)).toBeTruthy()
    expect(transferLockReason(cleanLocks({ modes: ['ONLINE'] }), one, grp)).toBeNull()
  })
  it('a deal with its own One-to-One pieces adds both results', () => {
    const base = { net: 100, gross: 110 }
    const line = { label: 'x', labelAr: 'س', quantity: 1, rate: 10, amount: 10, payer: 'PARTNER' as const }
    const m = mergeOneToOne({ lines: [line], shareTotal: 10, balanceForTechNova: 10, sessionsCounted: 2, base }, { lines: [line], shareTotal: 5, balanceForTechNova: -5, sessionsCounted: 1, base })
    expect([m.shareTotal, m.balanceForTechNova, m.sessionsCounted, m.base.net, m.lines[1].label]).toEqual([15, 5, 3, 200, 'One-to-One — x'])
  })
  it('a family can move a session in time and within the month limit', () => {
    const rules = { cancelHours: 24, postponesPerMonth: 2 }
    expect(postponeProblem(30, 1, rules)).toBeNull()
    expect(postponeProblem(23, 0, rules)).toContain('24')
    expect(postponeProblem(30, 2, rules)).toContain('2')
  })
  it('a no-show = everybody absent; an excused or present student is not', () => {
    expect([...noShowDays([{ date: 'a', status: 'ABSENT' }, { date: 'b', status: 'EXCUSED' }, { date: 'c', status: 'PRESENT' }])]).toEqual(['a'])
    expect([...noShowDays([{ date: 'a', status: 'ABSENT' }, { date: 'a', status: 'PRESENT' }])]).toEqual([])
  })
  it('carrying: at most the set number of plans; only after the month has passed', () => {
    expect(carryCount(7, 8, 1)).toBe(7)
    expect(carryCount(9, 8, 1)).toBe(8)
    expect(carryCount(7, 8, 0)).toBe(0)
    expect(canCarryNow('2026-10-01', '2026-10-29', 2)).toBe(true)
    expect(canCarryNow('2026-10-05', '2026-10-29', 2)).toBe(false)
    expect(canCarryNow('2026-10-01', '2026-10-29', 0)).toBe(false)
    expect(canCarryNow(null, '2026-10-29', 2)).toBe(false)
  })
  it('the fixed time is held for the set days after the last session', () => {
    expect(holdOver('2026-10-20', '2026-10-27', 7)).toBe(false)
    expect(holdOver('2026-10-20', '2026-10-28', 7)).toBe(true)
    expect(holdOver(null, '2026-10-28', 7)).toBe(false)
  })
  it('clashes use each session its own length', () => {
    expect(overlapsBy('13:00', 60, '14:00', 60)).toBe(false)
    expect(overlapsBy('13:00', 60, '13:30', 60)).toBe(true)
    expect(overlapsBy('13:00', 90, '14:00', 60)).toBe(true)
    const a = { groupId: 'a', label: 'A', dayOfWeek: 1, time: '13:00', mode: 'BRANCH' as const, campusId: 'c', minutes: 60 }
    const b = { ...a, groupId: 'b', time: '14:00', minutes: null }
    expect(teachClash(a, [b], 90)).toBeNull()
    expect(teachClash({ ...a, minutes: null }, [b], 90)).toEqual(b)
  })
})
