import { describe, expect, it } from 'vitest'
import { allowsCampus, allowsGroup, campusWhere, groupWhere, narrow, placeForCreate, resolvePlaces, studentWhere, teacherServes } from '@/lib/places/rules'

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
