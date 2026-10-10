/** LMS L3: change (PATCH, curriculum:update) or retire (DELETE, curriculum:delete) a rubric. Graded work keeps its own copy. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requirePermission, requireSession } from '@/lib/academic/api-helpers'
import { rubricCriteriaSchema } from '@/lib/assignments/rules'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'curriculum', 'update')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({
    nameEn: z.string().trim().min(1).max(120).optional(), nameAr: z.string().trim().max(120).optional(),
    subjectId: z.string().nullish(), criteria: rubricCriteriaSchema.optional(), kidStars: z.boolean().optional(),
  }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const found = await prisma.rubric.findUnique({ where: { id }, select: { id: true } })
  if (!found) return errors.notFound('Rubric')
  await prisma.rubric.update({ where: { id }, data: { ...parsed.data, criteria: parsed.data.criteria as never } })
  return successResponse(null, 'Saved')
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'curriculum', 'delete')
  if (denied) return denied
  const found = await prisma.rubric.findUnique({ where: { id }, select: { id: true } })
  if (!found) return errors.notFound('Rubric')
  await prisma.rubric.update({ where: { id }, data: { isActive: false } })
  return successResponse(null, 'Removed')
}
