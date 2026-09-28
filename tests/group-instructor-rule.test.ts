import { describe, expect, it } from 'vitest'
import { pickGroupInstructorOffering } from '@/lib/groups/instructor'

const d = (s: string) => new Date(s)

describe('pickGroupInstructorOffering', () => {
  it('prefers the current course + active year row (the one the instructor endpoint writes)', () => {
    const offerings = [
      { id: 'current', subjectId: 'S1', academicYearId: 'Y1', teacherId: 'T1', createdAt: d('2026-01-01') },
      // newer row from another place (e.g. Academic Engine) — used to win before the fix
      { id: 'newer-other', subjectId: 'S9', academicYearId: 'Y1', teacherId: null, createdAt: d('2026-09-01') },
    ]
    expect(pickGroupInstructorOffering(offerings, 'S1', 'Y1')?.id).toBe('current')
  })

  it('an explicitly unassigned current row means "no instructor"', () => {
    const offerings = [
      { id: 'current', subjectId: 'S1', academicYearId: 'Y1', teacherId: null, createdAt: d('2026-01-01') },
      { id: 'old-year', subjectId: 'S1', academicYearId: 'Y0', teacherId: 'T0', createdAt: d('2025-01-01') },
    ]
    expect(pickGroupInstructorOffering(offerings, 'S1', 'Y1')?.teacherId).toBeNull()
  })

  it('falls back to the newest row that has a teacher', () => {
    const offerings = [
      { id: 'a', subjectId: 'S1', academicYearId: 'Y0', teacherId: 'T0', createdAt: d('2025-01-01') },
      { id: 'b', subjectId: 'S2', academicYearId: 'Y0', teacherId: 'T2', createdAt: d('2025-06-01') },
      { id: 'c', subjectId: 'S3', academicYearId: 'Y0', teacherId: null, createdAt: d('2025-09-01') },
    ]
    expect(pickGroupInstructorOffering(offerings, 'S1', 'Y1')?.id).toBe('b')
  })

  it('returns null when there is nothing', () => {
    expect(pickGroupInstructorOffering([], 'S1', 'Y1')).toBeNull()
  })
})
