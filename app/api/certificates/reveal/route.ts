import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { checkPermission } from '@/lib/rbac'
import type { Role } from '@prisma/client'

/**
 * GET /api/certificates/reveal?status=pending|revealed|all
 * Lists certificates for the reveal-management screen. Defaults to
 * "pending" (isRevealed: false) but can also list already-revealed ones so
 * the admin can re-hide a specific certificate from the same screen.
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'documents', 'read')) return errors.forbidden()

  const status = request.nextUrl.searchParams.get('status') ?? 'pending'
  const where: Record<string, unknown> = { status: 'VALID' }
  if (status === 'pending') where.isRevealed = false
  else if (status === 'revealed') where.isRevealed = true
  // status === 'all' → no isRevealed filter

  const certificates = await prisma.certificate.findMany({
    where,
    include: {
      student: { select: { id: true, firstName: true, lastName: true, fullNameAr: true, profilePicture: true } },
      subject: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse(certificates)
}

const revealSchema = z.object({
  scope: z.enum(['certificate', 'certificates', 'student', 'subject', 'all']),
  certificateId: z.string().optional(),
  certificateIds: z.array(z.string()).optional(),
  studentId: z.string().optional(),
  subjectId: z.string().optional(),
  isRevealed: z.boolean().default(true), // false = hide instead of reveal
})

/**
 * POST /api/certificates/reveal — reveal (or, with isRevealed:false, re-hide)
 * certificates matching the given scope. "certificates" takes an arbitrary
 * list of IDs for ad-hoc multi-select (one, a handful, or a mix across
 * groups). "all" applies to every certificate in the current pending/
 * revealed state — intended for the day of the annual ceremony.
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

  const where: Record<string, unknown> = { isRevealed: !data.isRevealed }
  if (data.scope === 'certificate') {
    if (!data.certificateId) return errors.validation({ errors: [{ path: ['certificateId'], message: 'Required for this scope' }] } as never)
    where.id = data.certificateId
  } else if (data.scope === 'certificates') {
    if (!data.certificateIds || data.certificateIds.length === 0) return errors.validation({ errors: [{ path: ['certificateIds'], message: 'Required for this scope' }] } as never)
    where.id = { in: data.certificateIds }
  } else if (data.scope === 'student') {
    if (!data.studentId) return errors.validation({ errors: [{ path: ['studentId'], message: 'Required for this scope' }] } as never)
    where.studentId = data.studentId
  } else if (data.scope === 'subject') {
    if (!data.subjectId) return errors.validation({ errors: [{ path: ['subjectId'], message: 'Required for this scope' }] } as never)
    where.subjectId = data.subjectId
  }
  // scope === 'all' leaves the where clause as just { isRevealed: !data.isRevealed }

  const result = await prisma.certificate.updateMany({
    where,
    data: data.isRevealed
      ? { isRevealed: true, revealedAt: new Date(), revealedBy: session.user.id }
      : { isRevealed: false, revealedAt: null, revealedBy: null },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'UPDATE',
      entityType: 'CertificateReveal',
      entityId: data.certificateId ?? data.studentId ?? data.subjectId ?? (data.certificateIds ? data.certificateIds.join(',') : 'ALL'),
      changes: { scope: data.scope, revealedCount: result.count },
    },
  })

  return successResponse({ revealedCount: result.count })
}
