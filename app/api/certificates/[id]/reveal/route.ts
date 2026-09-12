import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { checkPermission } from '@/lib/rbac'
import type { Role } from '@prisma/client'

const toggleSchema = z.object({ isRevealed: z.boolean() })

/**
 * PATCH /api/certificates/[id]/reveal
 * Sets a single certificate's reveal state directly — used to re-hide a
 * certificate that was revealed too early (e.g. by mistake), in addition to
 * the bulk reveal flow in /api/certificates/reveal.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'documents', 'update')) return errors.forbidden()

  const { id } = await params
  const existing = await prisma.certificate.findUnique({ where: { id } })
  if (!existing) return errors.notFound('Certificate')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: ['body'], message: 'Invalid JSON' }] } as never)
  }
  const parsed = toggleSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const updated = await prisma.certificate.update({
    where: { id },
    data: parsed.data.isRevealed
      ? { isRevealed: true, revealedAt: new Date(), revealedBy: session.user.id }
      : { isRevealed: false, revealedAt: null, revealedBy: null },
  })

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      action: 'UPDATE',
      entityType: 'CertificateReveal',
      entityId: id,
      changes: { isRevealed: parsed.data.isRevealed },
    },
  })

  return successResponse(updated)
}
