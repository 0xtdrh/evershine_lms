import { describe, expect, it } from 'vitest'
import { attendanceTarget } from '@/lib/attendance/entry'

describe('/dashboard/attendance sends every role to its screen (final test 18/11)', () => {
  it('all staff roles and instructors go to the group attendance screen, never the old English roster', () => {
    for (const r of ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT', 'TEACHER']) expect(attendanceTarget(r)).toBe('/dashboard/attendance/sections')
  })
  it('students and parents go to their own attendance', () => {
    expect(attendanceTarget('STUDENT')).toBe('/dashboard/learning')
    expect(attendanceTarget('PARENT')).toBe('/dashboard/my-children')
    expect(attendanceTarget('GUARDIAN')).toBe('/dashboard/my-children')
  })
})
