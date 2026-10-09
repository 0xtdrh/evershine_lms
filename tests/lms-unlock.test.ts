import { describe, expect, it } from 'vitest'
import { cycleRange, effectiveMode, sessionDone, sessionStates, type UnlockInput } from '@/lib/lms/unlock'
import { cairoDateTimeToUtc } from '@/lib/dates/cairo'

const base = (over: Partial<UnlockInput> = {}): UnlockInput => ({
  mode: 'ATTENDANCE', totalSessions: 16, perCycle: 8, cycleNumber: 1, heldCount: 0, now: new Date('2026-10-10T12:00:00Z'), ...over,
})
const openNos = (i: UnlockInput) => sessionStates(i).filter((s) => s.open).map((s) => s.number)

describe('LMS L2 — which lessons are open', () => {
  it('mode: group > level > company > ATTENDANCE', () => {
    expect(effectiveMode('MANUAL', 'ALL', 'SCHEDULE')).toBe('MANUAL')
    expect(effectiveMode(null, 'ALL', 'SCHEDULE')).toBe('ALL')
    expect(effectiveMode(null, null, 'SCHEDULE')).toBe('SCHEDULE')
    expect(effectiveMode(null, null, null)).toBe('ATTENDANCE')
    expect(effectiveMode('nonsense', undefined, 'bad')).toBe('ATTENDANCE')
  })

  it('month 2 of a 2-month level covers curriculum sessions 9–16', () => {
    expect(cycleRange(8, 2, 16)).toEqual({ from: 9, to: 16 })
    expect(cycleRange(8, 1, 16)).toEqual({ from: 1, to: 8 })
    expect(cycleRange(8, 3, 16)).toEqual({ from: 17, to: 16 })
  })

  it('ATTENDANCE: opens the sessions whose attendance was recorded', () => {
    expect(openNos(base())).toEqual([])
    expect(openNos(base({ heldCount: 3 }))).toEqual([1, 2, 3])
    const st = sessionStates(base({ heldCount: 3 }))
    expect(st.find((s) => s.current)?.number).toBe(3)
  })

  it('later months: earlier months stay open for revision, next month stays locked', () => {
    expect(openNos(base({ cycleNumber: 2, heldCount: 2 }))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(sessionStates(base({ cycleNumber: 2 })).find((s) => s.number === 3)?.reason).toBe('EARLIER_MONTH')
  })

  it('ALL opens the whole level', () => {
    expect(openNos(base({ mode: 'ALL' })).length).toBe(16)
  })

  it('MANUAL: only what the instructor opened (even after attendance)', () => {
    expect(openNos(base({ mode: 'MANUAL', heldCount: 4 }))).toEqual([])
    expect(openNos(base({ mode: 'MANUAL', heldCount: 4, overrides: { 2: 'OPEN' } }))).toEqual([2])
  })

  it('the instructor can open early or lock a held session', () => {
    expect(openNos(base({ heldCount: 2, overrides: { 5: 'OPEN', 1: 'LOCKED' } }))).toEqual([2, 5])
  })

  it('SCHEDULE: opens when the start time has come', () => {
    const i = base({ mode: 'SCHEDULE', scheduledStarts: { 1: '2026-10-09T13:00:00Z', 2: '2026-10-10T11:59:00Z', 3: '2026-10-10T12:01:00Z' } })
    expect(openNos(i)).toEqual([1, 2])
  })

  it('PREVIOUS: first lesson, then each one after the previous is finished', () => {
    expect(openNos(base({ mode: 'PREVIOUS' }))).toEqual([1])
    expect(openNos(base({ mode: 'PREVIOUS', completed: new Set([1, 2]) }))).toEqual([1, 2, 3])
  })

  it('a session is done when every visible item is ticked', () => {
    expect(sessionDone(['a', 'b'], new Set(['a']))).toBe(false)
    expect(sessionDone(['a', 'b'], new Set(['a', 'b', 'x']))).toBe(true)
  })

  it('Cairo wall-clock time → real moment (summer +3, winter +2)', () => {
    expect(cairoDateTimeToUtc('2026-07-01', '16:00').toISOString()).toBe('2026-07-01T13:00:00.000Z')
    expect(cairoDateTimeToUtc('2026-12-01', '16:00').toISOString()).toBe('2026-12-01T14:00:00.000Z')
  })
})
