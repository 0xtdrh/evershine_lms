/** LMS L4: change (PATCH, curriculum:update) or retire (DELETE, curriculum:delete) a bank question. Finished tries keep their copy. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requirePermission, requireSession } from '@/lib/academic/api-helpers'
import { quizQuestionSchema } from '@/lib/quizzes/rules'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'curriculum', 'update')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ levelId: z.string().nullish(), difficulty: z.number().int().min(1).max(3).optional(), skillIds: z.array(z.string()).max(10).optional(), question: quizQuestionSchema.optional() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const found = await prisma.question.findUnique({ where: { id }, select: { id: true } })
  if (!found) return errors.notFound('Question')
  const d = parsed.data
  const q = d.question
  await prisma.question.update({
    where: { id },
    data: {
      ...(d.levelId !== undefined ? { levelId: d.levelId } : {}), ...(d.difficulty ? { difficulty: d.difficulty } : {}), ...(d.skillIds ? { skillIds: d.skillIds as never } : {}),
      ...(q ? (() => { const { id: _i, type, textEn, textAr, points, ...rest } = q; return { type: type!, textEn: textEn ?? '', textAr: textAr ?? '', points: points ?? 1, data: rest as never } })() : {}),
    },
  })
  return successResponse(null, 'Saved')
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'curriculum', 'delete')
  if (denied) return denied
  const found = await prisma.question.findUnique({ where: { id }, select: { id: true } })
  if (!found) return errors.notFound('Question')
  await prisma.question.update({ where: { id }, data: { isActive: false } })
  return successResponse(null, 'Removed')
}
