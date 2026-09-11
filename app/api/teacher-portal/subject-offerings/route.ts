/**
 * GET /api/teacher-portal/subject-offerings
 *
 * Returns active subject offerings assigned to the requesting teacher,
 * including class section and subject details.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { getTeacherClassSectionIds } from '@/lib/academic/teacher-scope'

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) return errors.unauthorized()
    if (session.user.role !== 'TEACHER') return errors.forbidden('Only teachers can access subject offerings')

    const teacher = await prisma.teacher.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    })
    if (!teacher) return successResponse([])

    const activeYear = await getActiveAcademicYear()
    if (!activeYear) return successResponse([])

    const allowedSectionIds = await getTeacherClassSectionIds(teacher.id, activeYear.id)

    // WHY no early-return on empty allowedSectionIds: a teacher can be
    // assigned directly on a SubjectOffering (teacherId) without ever having
    // a TeacherSectionAssignment (that's a separate "class teacher"
    // concept). Bailing out early here used to hide offerings that only
    // matched via teacherId directly.
    const offerings = await prisma.subjectOffering.findMany({
      where: {
        academicYearId: activeYear.id,
        OR: [
          { teacherId: teacher.id },
          ...(allowedSectionIds.length > 0 ? [{ classSectionId: { in: allowedSectionIds } }] : []),
        ],
      },
      include: {
        subject: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        classSection: {
          select: {
            id: true,
            className: true,
            sectionName: true,
          },
        },
      },
      orderBy: [
        { classSection: { className: 'asc' } },
        { classSection: { sectionName: 'asc' } },
        { subject: { name: 'asc' } },
      ],
    })

    return successResponse(offerings)
  } catch (err) {
    console.error('[TEACHER_OFFERINGS_GET]', err)
    return errors.internal()
  }
}
