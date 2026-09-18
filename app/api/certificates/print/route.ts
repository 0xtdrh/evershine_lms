import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { checkPermission } from '@/lib/rbac'
import { resolvePrintCertificates } from '@/lib/certificates/resolve-print-certificates'
import type { Role } from '@prisma/client'

/**
 * GET /api/certificates/print — list previous print batches (ceremony history).
 */
export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'documents', 'read')) return errors.forbidden()

  const batches = await prisma.certificatePrintBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return successResponse(batches)
}

const printSchema = z.object({
  certificateIds: z.array(z.string()).min(1),
  mode: z.enum(['GROUPED', 'COMBINED']).default('GROUPED'),
  label: z.string().min(2),
})

/**
 * POST /api/certificates/print
 * Returns the full render payload (template + field values) for the requested
 * certificates, ordered by course then level, and records the batch in the
 * print history. The actual PDF is generated client-side, which avoids
 * shipping a headless browser into the serverless runtime.
 */
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'documents', 'read')) return errors.forbidden()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: ['body'], message: 'Invalid JSON' }] } as never)
  }
  const parsed = printSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const data = parsed.data

  const resolved = await resolvePrintCertificates(data.certificateIds)
  if (resolved.length === 0) return errors.notFound('Certificates')

  // A certificate with no template of its own now falls back to the current
  // default template (see resolvePrintCertificates) — so this only fails when
  // literally no default template exists yet. Check *before* recording the
  // batch: a print-history entry should never be created for an export that
  // produced nothing.
  const renderable = resolved.filter((c) => c.template)
  if (renderable.length === 0) {
    return errors.validation({
      errors: [{ path: ['certificateIds'], message: 'None of the selected certificates have a design template. Upload one in Certificate Designer first.' }],
    } as never)
  }

  const batch = await prisma.certificatePrintBatch.create({
    data: {
      label: data.label,
      mode: data.mode,
      certificateIds: resolved.map((c) => c.id),
      totalCount: resolved.length,
      printedBy: session.user.id,
    },
  })

  return createdResponse({
    batchId: batch.id,
    mode: data.mode,
    certificates: resolved,
  })
}
