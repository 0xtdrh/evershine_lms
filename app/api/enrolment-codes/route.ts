/**
 * GET /api/enrolment-codes — six phases 1-a: code batches (discounts:read).
 * POST /api/enrolment-codes — make a batch of codes (discounts:create). Codes are discounts, so the Discounts permissions apply.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { batchSchema } from '@/lib/site/codes'
import { createBatch, listBatches } from '@/lib/site/codes-store'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

async function who(action: 'read' | 'create') {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() }
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'discounts', action)) return { error: errors.forbidden() }
  return { userId: session.user.id }
}

export async function GET() {
  const w = await who('read')
  if (w.error) return w.error
  const [batches, listings, partners] = await Promise.all([
    listBatches(),
    prisma.courseListing.findMany({ select: { slug: true, titleAr: true, titleEn: true }, orderBy: { slug: 'asc' } }),
    prisma.partner.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])
  return successResponse({ batches, listings, partners })
}

export async function POST(request: NextRequest) {
  const w = await who('create')
  if (w.error) return w.error
  const parsed = batchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  if (await prisma.enrolmentCode.findFirst({ where: { batch: parsed.data.batch.toUpperCase() }, select: { id: true } })) return errors.badRequest('This batch name is used · اسم المجموعة ده مستخدم')
  return createdResponse(await createBatch(w.userId!, parsed.data))
}
