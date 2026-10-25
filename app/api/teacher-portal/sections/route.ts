/**
 * GET /api/teacher-portal/sections
 *
 * Returns class sections assigned to the teacher.
 */

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { getTeacherClassSectionIds, teacherCoveredSections } from '@/lib/academic/teacher-scope'
import { cairoToday } from '@/lib/dates/cairo'

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user) return errors.unauthorized()
    if (session.user.role !== 'TEACHER') return errors.forbidden('Only teachers can access sections')

    const teacher = await prisma.teacher.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    })
    if (!teacher) return successResponse([])

    const activeYear = await getActiveAcademicYear()
    const ownIds = await getTeacherClassSectionIds(teacher.id, activeYear?.id)
    // 2026-10-25: + groups covered as a substitute (accepted) from a week ago to tomorrow, marked coveringDates
    const today = cairoToday()
    const shift = (n: number) => new Date(new Date(`${today}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
    const covered = await teacherCoveredSections(teacher.id, shift(-7), shift(1))
    const coverDays = new Map<string, string[]>()
    for (const c of covered) if (!ownIds.includes(c.classSectionId)) coverDays.set(c.classSectionId, [...(coverDays.get(c.classSectionId) ?? []), c.date.toISOString().slice(0, 10)])
    const allowedSectionIds = [...ownIds, ...coverDays.keys()]
    if (allowedSectionIds.length === 0) return successResponse([])

    const sections = await prisma.classSection.findMany({
      where: {
        id: { in: allowedSectionIds },
        isActive: true,
      },
      select: {
        id: true,
        className: true,
        sectionName: true,
        shift: { select: { code: true, name: true } },
        batch: { select: { name: true } },
      },
      orderBy: [{ grade: 'asc' }, { sectionName: 'asc' }],
    })

    return successResponse(sections.map((s) => ({ ...s, coveringDates: coverDays.get(s.id) ?? null })))
  } catch (err) {
    console.error('[TEACHER_SECTIONS_GET]', err)
    return errors.internal()
  }
}
