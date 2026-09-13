import { beforeEach, describe, expect, it, vi } from 'vitest'

const { assignmentFindMany, offeringFindMany, academicYearFindUnique } = vi.hoisted(() => ({
  assignmentFindMany: vi.fn(),
  offeringFindMany: vi.fn(),
  academicYearFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    teacher: { findUnique: vi.fn() },
    academicYear: { findUnique: academicYearFindUnique },
    teacherSectionAssignment: { findMany: assignmentFindMany },
    subjectOffering: { findMany: offeringFindMany },
  },
}))

vi.mock('@/lib/academic/engine', () => ({
  getActiveAcademicYear: vi.fn(async () => ({ id: 'year-1', name: '2024-2025' })),
}))

import { getTeacherClassSectionIds, teacherCanAccessClassSection } from '@/lib/academic/teacher-scope'

describe('teacher section resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assignmentFindMany.mockResolvedValue([])
    offeringFindMany.mockResolvedValue([])
    academicYearFindUnique.mockResolvedValue({ id: 'year-2', name: '2025-2026' })
  })

  it('returns active canonical assignments for the active academic year', async () => {
    assignmentFindMany.mockResolvedValue([
      { id: 'assignment-a', teacherId: 'teacher-1', classSectionId: 'sec-a', academicYearId: 'year-1', isClassTeacher: true, status: 'ACTIVE' },
      { id: 'assignment-b', teacherId: 'teacher-1', classSectionId: 'sec-b', academicYearId: 'year-1', isClassTeacher: false, status: 'ACTIVE' },
    ])

    await expect(getTeacherClassSectionIds('teacher-1')).resolves.toEqual(['sec-a', 'sec-b'])
    expect(assignmentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        teacherId: 'teacher-1',
        academicYearId: 'year-1',
        status: 'ACTIVE',
        classSection: { isActive: true },
      },
    }))
  })

  it('also grants access to sections where the teacher has a direct SubjectOffering, even with no formal assignment', async () => {
    offeringFindMany.mockResolvedValue([{ classSectionId: 'sec-x' }])

    await expect(getTeacherClassSectionIds('teacher-1')).resolves.toEqual(['sec-x'])
    expect(offeringFindMany).toHaveBeenCalledWith({
      where: { teacherId: 'teacher-1', academicYearId: 'year-1' },
      select: { classSectionId: true },
    })
  })

  it('merges and de-duplicates assignment-based and offering-based sections', async () => {
    assignmentFindMany.mockResolvedValue([
      { id: 'assignment-a', teacherId: 'teacher-1', classSectionId: 'sec-a', academicYearId: 'year-1', isClassTeacher: true, status: 'ACTIVE' },
    ])
    offeringFindMany.mockResolvedValue([
      { classSectionId: 'sec-a' }, // overlaps with the assignment above
      { classSectionId: 'sec-x' },
    ])

    const result = await getTeacherClassSectionIds('teacher-1')
    expect(result.sort()).toEqual(['sec-a', 'sec-x'])
  })

  it('does not grant access from historical timetable, task, or result records', async () => {
    await expect(getTeacherClassSectionIds('teacher-1')).resolves.toEqual([])
    expect(assignmentFindMany).toHaveBeenCalledTimes(1)
  })

  it('resolves an explicitly requested academic year instead of falling back to another year', async () => {
    assignmentFindMany.mockResolvedValue([
      { id: 'assignment-c', teacherId: 'teacher-1', classSectionId: 'sec-c', academicYearId: 'year-2', isClassTeacher: false, status: 'ACTIVE' },
    ])

    await expect(getTeacherClassSectionIds('teacher-1', 'year-2')).resolves.toEqual(['sec-c'])
    expect(academicYearFindUnique).toHaveBeenCalledWith({
      where: { id: 'year-2' },
      select: { id: true },
    })
  })

  it('checks section access against the merged assignment + offering set', async () => {
    assignmentFindMany.mockResolvedValue([
      { id: 'assignment-a', teacherId: 'teacher-1', classSectionId: 'sec-a', academicYearId: 'year-1', isClassTeacher: false, status: 'ACTIVE' },
    ])

    await expect(teacherCanAccessClassSection('teacher-1', 'sec-a')).resolves.toBe(true)
    await expect(teacherCanAccessClassSection('teacher-1', 'sec-b')).resolves.toBe(false)
  })
})
