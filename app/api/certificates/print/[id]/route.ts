import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { checkPermission } from '@/lib/rbac'
import { resolvePrintCertificates } from '@/lib/certificates/resolve-print-certificates'
import type { Role } from '@prisma/client'

/**
 * GET /api/certificates/print/[id]
 * Returns one print batch plus its certificates, resolved against the
 * *current* database state (template fallback, revocations, template edits)
 * so re-opening an old batch reflects anything that changed since it was
 * first printed — not what was true at print time.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'documents', 'read')) return errors.forbidden()

  const { id } = await params
  const batch = await prisma.certificatePrintBatch.findUnique({ where: { id } })
  if (!batch) return errors.notFound('Print batch')

  const storedIds = Array.isArray(batch.certificateIds) ? (batch.certificateIds as string[]) : []
  const [certificates, printedByUser] = await Promise.all([
    resolvePrintCertificates(storedIds),
    prisma.user.findUnique({ where: { id: batch.printedBy }, select: { displayName: true, email: true } }),
  ])

  return successResponse({
    batch: {
      id: batch.id,
      label: batch.label,
      mode: batch.mode,
      totalCount: batch.totalCount,
      printedBy: batch.printedBy,
      printedByName: printedByUser?.displayName || printedByUser?.email || null,
      createdAt: batch.createdAt,
    },
    certificates,
  })
}

const updateSchema = z.object({
  certificateIds: z.array(z.string()).min(1, 'A print batch must contain at least one certificate'),
})

/**
 * PATCH /api/certificates/print/[id]
 * Replaces the batch's certificate list — used for the add/remove controls
 * in the print-history UI. This only edits the CertificatePrintBatch record;
 * it never creates, deletes, or revokes an actual Certificate row.
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
  const existing = await prisma.certificatePrintBatch.findUnique({ where: { id } })
  if (!existing) return errors.notFound('Print batch')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: ['body'], message: 'Invalid JSON' }] } as never)
  }
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  // De-dupe defensively — the UI already excludes certificates already in the
  // batch from the "add" search, but never trust the client alone.
  const dedupedIds = Array.from(new Set(parsed.data.certificateIds))

  const certificates = await resolvePrintCertificates(dedupedIds)
  if (certificates.length === 0) return errors.notFound('Certificates')

  const updated = await prisma.certificatePrintBatch.update({
    where: { id },
    data: {
      certificateIds: certificates.map((c) => c.id),
      totalCount: certificates.length,
    },
  })

  return successResponse({
    batch: {
      id: updated.id,
      label: updated.label,
      mode: updated.mode,
      totalCount: updated.totalCount,
      printedBy: updated.printedBy,
      createdAt: updated.createdAt,
    },
    certificates,
  })
}

/**
 * DELETE /api/certificates/print/[id]
 * Removes the print-history record only. The underlying Certificate rows are
 * completely untouched — this just forgets that this export happened.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'documents', 'delete')) return errors.forbidden()

  const { id } = await params
  const existing = await prisma.certificatePrintBatch.findUnique({ where: { id } })
  if (!existing) return errors.notFound('Print batch')

  await prisma.certificatePrintBatch.delete({ where: { id } })

  return successResponse({ id, deleted: true })
}
