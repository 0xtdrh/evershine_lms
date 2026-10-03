/** GET /api/students/[id]/birthday-card — phase C: data for the printable birthday certificate (staff, instructors, parents, the student). */

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { studentViewer } from '@/lib/students/access'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  if (!(await studentViewer(session.user, id))) return errors.forbidden()
  const s = await prisma.student.findUnique({
    where: { id },
    select: {
      firstName: true, lastName: true, dateOfBirth: true, registrationNumber: true, profilePicture: true,
      enrollments: { where: { status: 'ACTIVE', classSection: { status: 'ACTIVE' } }, select: { classSection: { select: { className: true, sectionName: true } } }, take: 2 },
    },
  })
  if (!s) return errors.notFound('Student')
  return successResponse({
    firstName: s.firstName,
    lastName: s.lastName,
    dateOfBirth: s.dateOfBirth,
    registrationNumber: s.registrationNumber,
    photoUrl: s.profilePicture,
    group: s.enrollments.map((e) => `${e.classSection.className} ${e.classSection.sectionName}`.trim()).join(', ') || '—',
  })
}
