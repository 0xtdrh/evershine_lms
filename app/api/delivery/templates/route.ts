/**
 * GET  /api/delivery/templates — a02 M1 batch 2: the ready mixes of ways (templates) for groups' weekly sessions.
 * POST /api/delivery/templates { name, nameAr?, pattern: ['ONLINE','BRANCH',…] } — add one (class_sections:update).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { MODES } from '@/lib/delivery/modes'

export const dynamic = 'force-dynamic'

const schema = z.object({ name: z.string().trim().min(2).max(120), nameAr: z.string().trim().max(120).nullish(), pattern: z.array(z.enum(MODES)).min(1).max(7) })

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role, 'class_sections', 'read')) return errors.forbidden()
  return successResponse(await prisma.deliveryTemplate.findMany({ orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }] }))
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role, 'class_sections', 'update')) return errors.forbidden()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const row = await prisma.deliveryTemplate.create({ data: { name: parsed.data.name!, nameAr: parsed.data.nameAr || null, pattern: parsed.data.pattern! } })
  return createdResponse(row, 'Template added · القالب اتضاف')
}
