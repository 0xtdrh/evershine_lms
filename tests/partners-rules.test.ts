import { afterEach, describe, expect, it } from 'vitest'
import { contractAlertDue, contractProblem, contractState, daysLeft, placeCode } from '@/lib/partners/rules'
import { checkPermission, setPermissionContextProvider, setPermissionOverrides } from '@/lib/rbac'

const d = (s: string) => new Date(`${s}T10:00:00Z`)

describe('contracts (M1)', () => {
  const now = d('2026-10-14')
  it('state: not started / active / ending soon / ended / open-ended', () => {
    expect(contractState({ startDate: d('2026-11-01'), endDate: d('2027-06-30'), alertDaysBefore: 30 }, now)).toBe('NOT_STARTED')
    expect(contractState({ startDate: d('2026-09-01'), endDate: d('2027-06-30'), alertDaysBefore: 30 }, now)).toBe('ACTIVE')
    expect(contractState({ startDate: d('2026-09-01'), endDate: d('2026-11-10'), alertDaysBefore: 30 }, now)).toBe('ENDING_SOON')
    expect(contractState({ startDate: d('2026-01-01'), endDate: d('2026-10-13'), alertDaysBefore: 30 }, now)).toBe('ENDED')
    expect(contractState({ startDate: d('2026-01-01'), endDate: null, alertDaysBefore: 30 }, now)).toBe('OPEN_ENDED')
    expect(daysLeft(d('2026-10-14'), now)).toBe(0)
  })
  it('alerts: once inside the window, once on the last day; none without an end date', () => {
    const c = { endDate: d('2026-11-10'), alertDaysBefore: 30, alertSentAt: null, endedNoticeAt: null }
    expect(contractAlertDue(c, now)).toBe('BEFORE')
    expect(contractAlertDue({ ...c, alertSentAt: now }, now)).toBeNull()
    expect(contractAlertDue({ ...c, alertSentAt: now }, d('2026-11-10'))).toBe('ENDED')
    expect(contractAlertDue({ ...c, alertSentAt: now, endedNoticeAt: now }, d('2026-11-12'))).toBeNull()
    expect(contractAlertDue({ ...c, endDate: d('2027-06-30') }, now)).toBeNull()
    expect(contractAlertDue({ ...c, endDate: null }, now)).toBeNull()
  })
  it('dates must make sense', () => {
    expect(contractProblem({ startDate: d('2026-10-01'), endDate: d('2026-09-01'), alertDaysBefore: 30 })).toMatch(/before it starts/)
    expect(contractProblem({ startDate: d('2026-10-01'), endDate: null, alertDaysBefore: 400 })).toMatch(/365/)
    expect(contractProblem({ startDate: d('2026-10-01'), endDate: d('2027-10-01'), alertDaysBefore: 30 })).toBeNull()
  })
  it('place code', () => {
    expect(placeCode('Al Nour School', 'Kawther Branch')).toBe('ANS-KB')
    expect(placeCode('مدرسة', '')).toBe('P')
  })
})

describe('permission order: person > place > role > code (M1)', () => {
  afterEach(() => { setPermissionContextProvider(() => undefined); setPermissionOverrides([]) })
  it('the person’s own rule wins, then the place, then the Permissions page, then the code', () => {
    expect(checkPermission('SECRETARY', 'partners', 'read')).toBe(false)
    setPermissionOverrides([{ role: 'SECRETARY', resource: 'partners', action: 'read', isEnabled: true }])
    expect(checkPermission('SECRETARY', 'partners', 'read')).toBe(true)
    const ctx = { role: 'SECRETARY', user: new Map<string, boolean>(), place: new Map([['partners:read', false]]) }
    setPermissionContextProvider(() => ctx)
    expect(checkPermission('SECRETARY', 'partners', 'read')).toBe(false)
    ctx.user.set('partners:read', true)
    expect(checkPermission('SECRETARY', 'partners', 'read')).toBe(true)
  })
  it('only for the signed-in person’s own role, and never for Super Admin', () => {
    setPermissionContextProvider(() => ({ role: 'SECRETARY', user: new Map([['partners:read', true]]), place: new Map() }))
    expect(checkPermission('ACCOUNTANT', 'partners', 'read')).toBe(false)
    setPermissionContextProvider(() => ({ role: 'SUPER_ADMIN', user: new Map([['partners:read', false]]), place: new Map() }))
    expect(checkPermission('SUPER_ADMIN', 'partners', 'read')).toBe(true)
  })
})
