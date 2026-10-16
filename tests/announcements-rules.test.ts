import { describe, expect, it } from 'vitest'
import { checkPermission } from '@/lib/rbac'
import { draftProblem, parseAudiences, reach, statusFor } from '@/lib/announcements/rules'

const admin = { role: 'ADMIN', allPlaces: true, teachersCanSend: true }
const branch = { role: 'SECRETARY', allPlaces: false, teachersCanSend: true }
const teacher = { role: 'TEACHER', allPlaces: false, teachersCanSend: true }

describe('announcement rules (5-D)', () => {
  it('needs someone to receive it and items for a non-company scope', () => {
    expect(draftProblem({ audiences: [], scopeType: 'COMPANY', scopeIds: [] }, admin)).toBeTruthy()
    expect(draftProblem({ audiences: ['PARENT'], scopeType: 'GROUP', scopeIds: [] }, admin)).toBeTruthy()
    expect(draftProblem({ audiences: ['PARENT'], scopeType: 'COMPANY', scopeIds: [] }, admin)).toBeNull()
  })
  it('the whole company only for someone with every place', () => {
    expect(draftProblem({ audiences: ['PARENT'], scopeType: 'COMPANY', scopeIds: [] }, branch)).toBeTruthy()
    expect(draftProblem({ audiences: ['PARENT'], scopeType: 'CAMPUS', scopeIds: ['c1'] }, branch)).toBeNull()
  })
  it('staff only by company / branch / partner', () => {
    expect(draftProblem({ audiences: ['STAFF'], scopeType: 'GROUP', scopeIds: ['g1'] }, admin)).toBeTruthy()
    expect(draftProblem({ audiences: ['STAFF'], scopeType: 'CAMPUS', scopeIds: ['c1'] }, admin)).toBeNull()
  })
  it('instructors: own groups, parents / students only, and only while the setting allows', () => {
    expect(draftProblem({ audiences: ['PARENT'], scopeType: 'GROUP', scopeIds: ['g1'] }, teacher)).toBeNull()
    expect(draftProblem({ audiences: ['PARENT'], scopeType: 'LEVEL', scopeIds: ['l1'] }, teacher)).toBeTruthy()
    expect(draftProblem({ audiences: ['TEACHER'], scopeType: 'GROUP', scopeIds: ['g1'] }, teacher)).toBeTruthy()
    expect(draftProblem({ audiences: ['PARENT'], scopeType: 'GROUP', scopeIds: ['g1'] }, { ...teacher, teachersCanSend: false })).toBeTruthy()
  })
  it('approval follows the permission (set on the Permissions page)', () => {
    expect(statusFor(checkPermission('BRANCH_MANAGER', 'announcements', 'approve'))).toBe('PUBLISHED')
    expect(statusFor(checkPermission('SECRETARY', 'announcements', 'approve'))).toBe('PENDING')
    expect(checkPermission('TEACHER', 'announcements', 'create')).toBe(true)
    expect(checkPermission('PARENT', 'announcements', 'create')).toBe(false)
  })
  it('reach numbers', () => {
    const r = reach([{ readAt: new Date(), ackAt: new Date() }, { readAt: new Date(), ackAt: null }, { readAt: null, ackAt: null }, { readAt: null, ackAt: null }], true)
    expect(r).toEqual({ total: 4, read: 2, acked: 1, readPct: 50, ackPct: 25 })
    expect(reach([], false).ackPct).toBeNull()
    expect(parseAudiences('PARENT, STUDENT,NOPE')).toEqual(['PARENT', 'STUDENT'])
  })
})
