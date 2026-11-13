import { describe, expect, it } from 'vitest'
import { ageOn, arrangeCourses, canBook, courseFit, signupAccountSchema, staffAccountSchema, accountsSettingsSchema, phoneLoginEmail } from '@/lib/accounts/rules'

const track = { refType: 'TRACK' as const, refId: 'T1', trackId: 'T1', courseIds: ['C1', 'C2'], minAge: 8, maxAge: 12 }
const inner = { refType: 'COURSE' as const, refId: 'C2', trackId: 'T1', courseIds: ['C2'], minAge: 8, maxAge: 12 }
const open = { refType: 'COURSE' as const, refId: 'C9', trackId: null, courseIds: ['C9'], minAge: null, maxAge: null }

describe('which courses suit a child', () => {
  it('follows the age', () => {
    expect(courseFit(track, 10, [])).toBe('SUITABLE')
    expect(courseFit(track, 6, [])).toBe('TOO_YOUNG')
    expect(courseFit(track, 14, [])).toBe('TOO_OLD')
    expect(courseFit(open, 5, [])).toBe('SUITABLE')
    expect(courseFit(track, null, [])).toBe('SUITABLE')
  })
  it('staff can open a track (also its courses) or one course', () => {
    expect(courseFit(track, 6, [{ refType: 'TRACK', refId: 'T1' }])).toBe('OPENED')
    expect(courseFit(inner, 6, [{ refType: 'TRACK', refId: 'T1' }])).toBe('OPENED')
    expect(courseFit(inner, 6, [{ refType: 'COURSE', refId: 'C2' }])).toBe('OPENED')
    expect(courseFit(track, 6, [{ refType: 'COURSE', refId: 'C7' }])).toBe('TOO_YOUNG')
  })
  it('a course being learned shows as enrolled', () => {
    expect(courseFit(track, 10, [], ['C1'])).toBe('ENROLLED')
    expect(canBook('ENROLLED')).toBe(false)
    expect(canBook('OPENED')).toBe(true)
  })
  it('lock shows everything (open first); hide drops what cannot be booked', () => {
    const rows = [{ fit: 'TOO_YOUNG' as const, sortOrder: 0 }, { fit: 'SUITABLE' as const, sortOrder: 2 }, { fit: 'OPENED' as const, sortOrder: 5 }, { fit: 'ENROLLED' as const, sortOrder: 1 }]
    expect(arrangeCourses(rows, 'LOCK').map((r) => r.fit)).toEqual(['OPENED', 'SUITABLE', 'ENROLLED', 'TOO_YOUNG'])
    expect(arrangeCourses(rows, 'HIDE').map((r) => r.fit)).toEqual(['OPENED', 'SUITABLE', 'ENROLLED'])
  })
  it('ages on a Cairo day', () => {
    expect(ageOn('2008-11-13', '2026-11-13')).toBe(18)
    expect(ageOn('2008-11-14', '2026-11-13')).toBe(17)
    expect(ageOn(new Date('2016-01-01T00:00:00Z'), '2026-11-13')).toBe(10)
  })
})

describe('sign-up', () => {
  const base = { who: 'PARENT', firstName: 'Mona', lastName: 'Adel', phone: '01012345678', password: 'goodpass9', city: 'Hurghada', agree: true }
  it('accepts a parent; refuses a bad phone, no agreement, the phone as the password', () => {
    expect(signupAccountSchema.safeParse(base).success).toBe(true)
    expect(signupAccountSchema.safeParse({ ...base, phone: '123' }).success).toBe(false)
    expect(signupAccountSchema.safeParse({ ...base, agree: false }).success).toBe(false)
    expect(signupAccountSchema.safeParse({ ...base, password: '01012345678' }).success).toBe(false)
  })
  it('a student alone needs a birthday and gender', () => {
    expect(signupAccountSchema.safeParse({ ...base, who: 'SELF' }).success).toBe(false)
    expect(signupAccountSchema.safeParse({ ...base, who: 'SELF', dob: '2000-01-01', gender: 'MALE' }).success).toBe(true)
  })
  it('staff accounts need no password; settings have safe defaults', () => {
    expect(staffAccountSchema.safeParse({ firstName: 'Ali', lastName: 'Omar', phone: '01112345678' }).success).toBe(true)
    expect(accountsSettingsSchema.parse({})).toEqual({ signupOpen: true, unsuitable: 'LOCK', emailCheck: false, askExperience: true, linkDays: 7 })
    expect(phoneLoginEmail('01012345678')).toBe('guardian_01012345678@technova.local')
  })
})
