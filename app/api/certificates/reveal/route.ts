import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { checkPermission } from '@/lib/rbac'
import type { Role } from '@prisma/client'

/**
 * GET /api/certificates/reveal — list every certificate still awaiting the
 * reveal ceremony (isRevealed: false), grouped loosely by course so the
 * admin can pick a whole cohort at once.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'documents', 'read')) return errors.forbidden()

  const pending = await prisma.certificate.findMany({
    where: { isRevealed: false, status: 'VALID' },
    include: {
      student: { select: { id: true, firstName: true, lastName: true, fullNameAr: true, profilePicture: true } },
      subject: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse(pending)
}

const revealSchema = z.object({
  scope: z.enum(['certificate', 'student', 'subject', 'all']),
  certificateId: z.string().optional(),
  studentId: z.string().optional(),
  subjectId: z.string().optional(),
})

/**
 * POST /api/certificates/reveal — reveal (unblur) certificates matching the
 * given scope. "all" reveals every pending certificate — intended for the
 * day of the annual ceremony.
 */
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'documents', 'update')) return errors.forbidden()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: ['body'], message: 'Invalid JSON' }] } as never)
  }
  const parsed = revealSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const data = parsed.data

  const where: Record<string, unknown> = { isRevealed: false }
  if (data.scope === 'certificate') {
    if (!data.certificateId) return errors.validation({ errors: [{ path: ['certificateId'], message: 'Required for this scope' }] } as never)
    where.id = data.certificateId
  } else if (data.scope === 'student') {
    if (!data.studentId) return errors.validation({ errors: [{ path: ['studentId'], message: 'Required for this scope' }] } as never)
    where.studentId = data.studentId
  } else if (data.scope === 'subject') {
    if (!data.subjectId) return errors.validation({ errors: [{ path: ['subjectId'], message: 'Required for this scope' }] } as never)
    where.subjectId = data.subjectId
  }
  // scope === 'all' leaves the where clause as just { isRevealed: false }

  const result = await prisma.certificate.updateMany({
    where,
    data: { isRevealed: true, revealedAt: new Date(), revealedBy: session.user.id },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'UPDATE',
      entityType: 'CertificateReveal',
      entityId: data.certificateId ?? data.studentId ?? data.subjectId ?? 'ALL',
      changes: { scope: data.scope, revealedCount: result.count },
    },
  })

  return successResponse({ revealedCount: result.count })
}
