import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'

/**
 * GET /api/certificates/mine?studentId=xxx
 * Student sees their own certificates; a guardian must pass studentId for
 * one of their linked children. Certificates still awaiting the reveal
 * ceremony are included but flagged isRevealed:false so the UI can render
 * them blurred with a "ceremony coming soon" message — never hidden
 * entirely, since the student/parent should know a certificate was earned.
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()

  let studentId: string | null = null

  if (session.user.role === 'STUDENT') {
    const student = await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } })
    if (!student) return errors.notFound('Student profile')
    studentId = student.id
  } else if (session.user.role === 'GUARDIAN' || session.user.role === 'PARENT') {
    const requestedId = request.nextUrl.searchParams.get('studentId')
    if (!requestedId) return errors.validation({ errors: [{ path: ['studentId'], message: 'studentId is required' }] } as never)
    const guardian = await prisma.guardian.findUnique({
      where: { userId: session.user.id },
      include: { students: { select: { id: true } } },
    })
    const isLinked = guardian?.students.some((s) => s.id === requestedId)
    if (!isLinked) return errors.forbidden('This student is not linked to your account')
    studentId = requestedId
  } else {
    return errors.forbidden()
  }

  const certificates = await prisma.certificate.findMany({
    where: { studentId: studentId!, status: 'VALID' },
    include: {
      subject: { select: { name: true } },
      template: { select: { backgroundUrl: true, fieldLayout: true, widthPx: true, heightPx: true } },
    },
    orderBy: { issuedDate: 'desc' },
  })

  return successResponse(certificates)
}
