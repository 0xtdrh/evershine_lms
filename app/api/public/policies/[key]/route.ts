/** Rules & policies: GET /api/public/policies/[key] — one published public policy (no login). */

import { errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_r: Request, { params }: { params: Promise<{ key: string }> }) {
  const a = await prisma.agreement.findFirst({
    where: { key: (await params).key, isPublic: true, isActive: true },
    select: { key: true, titleEn: true, titleAr: true, bodyEn: true, bodyAr: true, version: true, publishedAt: true },
  })
  return a ? successResponse(a) : errors.notFound('Policy')
}
