import { describe, expect, it } from 'vitest'
import { allowsCampus, allowsGroup, campusWhere, groupWhere, invoiceWhere, narrow, onePlace, staffWhere, teacherWhere, userWhere, placeForCreate, resolvePlaces, studentWhere, teacherServes } from '@/lib/places/rules'

describe('resolvePlaces', () => {
  it('super admin and "all places" see everything; families see no places', () => {
    expect(resolvePlaces({ role: 'SUPER_ADMIN', allLocations: false, primary: 'A', extra: [], groups: [] }).all).toBe(true)
    expect(resolvePlaces({ role: 'SECRETARY', allLocations: true, primary: 'A', extra: [], groups: [] }).all).toBe(true)
    expect(resolvePlaces({ role: 'PARENT', allLocations: true, primary: null, extra: [], groups: [] })).toMatchObject({ all: false, campusIds: [] })
  })
  it('primary + extra places + single groups', () => {
    expect(resolvePlaces({ role: 'SECRETARY', allLocations: false, primary: 'A', extra: ['B', 'A'], groups: ['g9'] })).toEqual({ all: false, campusIds: ['A', 'B'], groupIds: ['g9'], primary: 'A' })
  })
  it('no place at all → every place (nobody locked out)', () => {
    expect(resolvePlaces({ role: 'ACCOUNTANT', allLocations: false, primary: null, extra: [], groups: [] }).all).toBe(true)
  })
})

describe('filters', () => {
  const sara = { all: false, campusIds: ['A'], groupIds: ['g-thu'], primary: 'A' }
  it('campus / group / student where', () => {
    expect(campusWhere(sara)).toEqual({ campusId: { in: ['A'] } })
    expect(groupWhere(sara)).toEqual({ AND: [{ OR: [{ campusId: { in: ['A'] } }, { id: { in: ['g-thu'] } }] }] })
    expect(studentWhere(sara)).toEqual({ AND: [{ OR: [{ campusId: { in: ['A'] } }, { enrollments: { some: { classSectionId: { in: ['g-thu'] } } } }] }] })
    expect(campusWhere({ all: true, campusIds: [], groupIds: [], primary: null })).toEqual({})
  })
  it('allows', () => {
    expect(allowsCampus(sara, 'B')).toBe(false)
    expect(allowsGroup(sara, { id: 'g-thu', campusId: 'B' })).toBe(true)
    expect(allowsGroup(sara, { id: 'g-fri', campusId: 'B' })).toBe(false)
  })
  it('the header filter narrows, never widens', () => {
    expect(narrow(sara, 'A')).toMatchObject({ campusIds: ['A'], groupIds: [] })
    expect(narrow(sara, 'B')).toBe(sara)
    expect(narrow({ all: true, campusIds: [], groupIds: [], primary: null }, 'B')).toMatchObject({ all: false, campusIds: ['B'] })
  })
  it('place for a new record', () => {
    expect(placeForCreate(sara, null)).toEqual({ ok: true, campusId: 'A' })
    expect(placeForCreate(sara, 'B')).toEqual({ ok: false, campusId: null })
    expect(placeForCreate({ all: true, campusIds: [], groupIds: [], primary: null }, 'B')).toEqual({ ok: true, campusId: 'B' })
  })
  it('instructor serves a place', () => {
    expect(teacherServes({ all: false, campusIds: ['A', 'B'] }, 'B')).toBe(true)
    expect(teacherServes({ all: false, campusIds: ['A'] }, 'B')).toBe(false)
  })
})

describe('finance (M0 batch 2)', () => {
  const sara = { all: false, campusIds: ['A'], groupIds: ['g-thu'], primary: 'A' }
  it('invoices: by the group place, or by the student when there is no group', () => {
    expect(invoiceWhere({ all: true, campusIds: [], groupIds: [], primary: null })).toEqual({})
    expect(invoiceWhere(sara)).toEqual({ AND: [{ OR: [{ classSection: groupWhere(sara) }, { AND: [{ classSectionId: null }, { student: studentWhere(sara) }] }] }] })
  })
  it('one place for a P&L / ledger: allowed request, else the primary; everything = company-wide', () => {
    expect(onePlace(sara, 'B')).toBe('A')
    expect(onePlace({ ...sara, campusIds: ['A', 'B'] }, 'B')).toBe('B')
    expect(onePlace({ all: true, campusIds: [], groupIds: [], primary: null }, null)).toBeNull()
    expect(onePlace({ all: false, campusIds: [], groupIds: ['g'], primary: null }, null)).toBe('__none__')
  })
})

describe('staff (M0 batch 3)', () => {
  const sara = { all: false, campusIds: ['A'], groupIds: ['g-thu'], primary: 'A' }
  const all = { all: true, campusIds: [], groupIds: [], primary: null }
  it('instructors: their place / extra place / every place / teaching a single group', () => {
    expect(teacherWhere(all)).toEqual({})
    expect(teacherWhere(sara)).toEqual({ AND: [{ OR: [
      { user: { allLocations: true } },
      { campusId: { in: ['A'] } },
      { user: { placeAccess: { some: { campusId: { in: ['A'] } } } } },
      { subjectOfferings: { some: { classSectionId: { in: ['g-thu'] } } } },
    ] }] })
  })
  it('office staff: their place or an extra place; nothing with single groups only', () => {
    expect(staffWhere({ ...sara, campusIds: [] })).toEqual({ AND: [{ OR: [{ campusId: { in: ['__none__'] } }, { user: { allLocations: true } }, { user: { placeAccess: { some: { campusId: { in: ['__none__'] } } } } }] }] })
  })
  it('accounts: own account always; everything for every place', () => {
    expect(userWhere(all, 'me')).toEqual({})
    const or = (userWhere(sara, 'me') as { AND: { OR: unknown[] }[] }).AND[0].OR
    expect(or[0]).toEqual({ id: 'me' })
    expect(or).toContainEqual({ parent: { students: { some: studentWhere(sara) } } })
  })
})
