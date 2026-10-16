/** Rules & policies: GET /api/public/policies — the published public policies (no login): key + titles. */

import { successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const rows = await prisma.agreement.findMany({ where: { isPublic: true, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { key: true, titleEn: true, titleAr: true } })
  return successResponse(rows)
}
