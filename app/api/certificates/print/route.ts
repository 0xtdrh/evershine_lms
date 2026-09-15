import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { checkPermission } from '@/lib/rbac'
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

  const certificates = await prisma.certificate.findMany({
    where: { id: { in: data.certificateIds }, status: 'VALID' },
    include: {
      student: { select: { id: true, firstName: true, lastName: true, fullNameEn: true, fullNameAr: true } },
      subject: { select: { id: true, name: true } },
      template: { select: { id: true, backgroundUrl: true, fieldLayout: true, widthPx: true, heightPx: true } },
    },
  })

  if (certificates.length === 0) return errors.notFound('Certificates')

  // Order by course name, then by certificate number (which is chronological
  // within a course, so levels naturally come out in the order they were earned).
  const ordered = [...certificates].sort((a, b) => {
    const courseCompare = (a.subject?.name ?? '').localeCompare(b.subject?.name ?? '')
    if (courseCompare !== 0) return courseCompare
    return a.certificateNumber.localeCompare(b.certificateNumber)
  })

  const batch = await prisma.certificatePrintBatch.create({
    data: {
      label: data.label,
      mode: data.mode,
      certificateIds: ordered.map((c) => c.id),
      totalCount: ordered.length,
      printedBy: session.user.id,
    },
  })

  return createdResponse({
    batchId: batch.id,
    mode: data.mode,
    certificates: ordered.map((c) => ({
      id: c.id,
      certificateNumber: c.certificateNumber,
      title: c.title,
      issuedDate: c.issuedDate,
      qrCodeUrl: c.qrCodeUrl,
      studentName: c.student.fullNameEn || `${c.student.firstName} ${c.student.lastName}`,
      studentNameAr: c.student.fullNameAr,
      courseName: c.subject?.name ?? '',
      template: c.template,
    })),
  })
}
