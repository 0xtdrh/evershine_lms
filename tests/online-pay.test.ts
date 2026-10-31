import { describe, expect, it } from 'vitest'
import { groupIsOnline, groupParts, modeOfDay, sessionRate } from '@/lib/teachers/online-pay'
import { statementGroup } from '@/lib/teachers/pay-statement-calc'

describe('instructor pay by the way a session is taught (a02 batch 6)', () => {
  const rule = { fixed: 1000, percent: 20, perSession: 100, onlineFixed: 800, onlinePercent: 15, onlinePerSession: 80 }
  it('per session: online rate for online, nothing for recorded, empty online rate = the normal one', () => {
    expect(sessionRate(rule, 'BRANCH')).toBe(100)
    expect(sessionRate(rule, 'ONLINE')).toBe(80)
    expect(sessionRate(rule, 'RECORDED')).toBeNull()
    expect(sessionRate({ fixed: null, percent: null, perSession: 100 }, 'ONLINE')).toBe(100)
  })
  it('a group is online when its place is the Online place or every slot is online', () => {
    expect(groupIsOnline('ONLINE', [])).toBe(true)
    expect(groupIsOnline('MAIN', [{ dayOfWeek: 0, mode: 'ONLINE' }, { dayOfWeek: 2, mode: 'ONLINE' }])).toBe(true)
    expect(groupIsOnline('MAIN', [{ dayOfWeek: 0, mode: 'ONLINE' }, { dayOfWeek: 2 }])).toBe(false)
    expect(groupIsOnline('MAIN', [])).toBe(false)
  })
  it('percent / fixed: online amounts only for an online group, empty = the normal one', () => {
    expect(groupParts(rule, true)).toEqual({ percent: 15, fixed: 800 })
    expect(groupParts(rule, false)).toEqual({ percent: 20, fixed: 1000 })
    expect(groupParts({ fixed: 1000, percent: 20, perSession: null }, true)).toEqual({ percent: 20, fixed: 1000 })
  })
  it('the way of a day: one-off change > slot of the weekday > branch', () => {
    const slots = [{ dayOfWeek: 0, mode: 'ONLINE' }, { dayOfWeek: 2, mode: 'BRANCH' }]
    expect(modeOfDay('2026-10-25', slots, new Map())).toBe('ONLINE') // Sunday
    expect(modeOfDay('2026-10-27', slots, new Map([['2026-10-27', 'ONLINE']]))).toBe('ONLINE')
    expect(modeOfDay('2026-10-28', slots, new Map())).toBe('BRANCH')
  })
  it('the statement splits branch / online sessions and skips recorded ones', () => {
    const g = statementGroup({
      id: 'g', label: 'G', place: 'P', rule, fixedCounts: false, students: [], adjustments: [],
      sessions: [
        { date: '2026-10-25', n: 1, of: 8, counted: true, mode: 'ONLINE' },
        { date: '2026-10-27', n: 2, of: 8, counted: true, mode: 'BRANCH' },
        { date: '2026-10-28', n: 3, of: 8, counted: true },
        { date: '2026-10-29', n: 4, of: 8, counted: true, mode: 'RECORDED' },
      ],
    })
    expect([g.branchSessions, g.branchAmount, g.onlineSessions, g.onlineAmount, g.recordedSessions, g.sessionsCounted, g.sessionAmount]).toEqual([2, 200, 1, 80, 1, 3, 280])
    expect(g.sessions.map((s) => s.rate ?? null)).toEqual([80, 100, 100, null])
  })
})
