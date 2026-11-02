import { describe, expect, it } from 'vitest'
import { levelFinished, nameFor, pickPrice, quote, type PriceRow } from '@/lib/one-to-one/rules'
import { sessionRate } from '@/lib/teachers/online-pay'
import { sessionsPerCycle } from '@/lib/groups/cycle-rules'

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
})
