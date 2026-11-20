import { beforeEach, describe, expect, it, vi } from 'vitest'

const { db, cover, own } = vi.hoisted(() => ({
  db: { teacherAbsence: { findFirst: vi.fn() }, substituteAssignment: { findFirst: vi.fn() } },
  cover: vi.fn(async () => false),
  own: vi.fn(async () => true),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/places/server', () => ({ canSeeGroup: vi.fn(async () => true) }))
vi.mock('@/lib/academic/teacher-scope', () => ({
  getTeacherByUserId: vi.fn(async () => ({ id: 't-own' })),
  teacherCanAccessClassSection: (...a: unknown[]) => own(...(a as [])),
  teacherCoversSectionOn: (...a: unknown[]) => cover(...(a as [])),
}))

import { approvedAbsenceMessage, groupAttendanceAccess } from '@/lib/attendance/access'

const teacher = { id: 'u1', role: 'TEACHER' }

describe('F13: the group instructor whose absence was approved cannot take that day (final test 15/11)', () => {
  beforeEach(() => { vi.clearAllMocks(); cover.mockResolvedValue(false); own.mockResolvedValue(true) })

  it('no approved absence: his own group opens', async () => {
    db.teacherAbsence.findFirst.mockResolvedValue(null)
    expect(await groupAttendanceAccess(teacher, 'g1', '2026-11-15')).toBeNull()
  })

  it('approved absence + accepted substitute: refused, and the message names the substitute', async () => {
    db.teacherAbsence.findFirst.mockResolvedValue({ id: 'a1' })
    db.substituteAssignment.findFirst.mockResolvedValue({ substituteTeacher: { firstName: 'أحمد', lastName: 'يوسف' } })
    const r = await groupAttendanceAccess(teacher, 'g1', '2026-11-15')
    expect(r?.status).toBe(403)
    const body = await r!.json()
    expect(body.error.code).toBe('ABSENT_THAT_DAY')
    expect(body.error.message).toContain('أحمد يوسف')
  })

  it('the lookup is that day, approved, whole day or this group only', async () => {
    db.teacherAbsence.findFirst.mockResolvedValue(null)
    await approvedAbsenceMessage('t-own', 'g1', '2026-11-15')
    expect(db.teacherAbsence.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { teacherId: 't-own', status: 'APPROVED', date: new Date('2026-11-15T00:00:00Z'), OR: [{ scope: 'FULL_DAY' }, { classSectionId: 'g1' }] },
    }))
  })

  it('the substitute covering that day is never blocked', async () => {
    cover.mockResolvedValue(true)
    db.teacherAbsence.findFirst.mockResolvedValue({ id: 'a1' })
    expect(await groupAttendanceAccess(teacher, 'g1', '2026-11-15')).toBeNull()
  })

  it('without a date (the group list) nothing is blocked', async () => {
    db.teacherAbsence.findFirst.mockResolvedValue({ id: 'a1' })
    expect(await groupAttendanceAccess(teacher, 'g1', null)).toBeNull()
  })
})
