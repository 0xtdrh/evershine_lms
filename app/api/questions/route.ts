/**
 * LMS L4: question bank. GET ?subjectId=&levelId=&type=&difficulty= (curriculum:read). POST (curriculum:update)
 * { subjectId, levelId?, difficulty?, skillIds?, question: { type, textEn, textAr, points, … } }.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { requirePermission, requireSession } from '@/lib/academic/api-helpers'
import { quizQuestionSchema } from '@/lib/quizzes/rules'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'curriculum', 'read')
  if (denied) return denied
  const q = request.nextUrl.searchParams
  const subjectId = q.get('subjectId')
  if (!subjectId) return errors.badRequest('subjectId is required')
  const rows = await prisma.question.findMany({
    where: { subjectId, isActive: true, ...(q.get('levelId') ? { levelId: q.get('levelId') } : {}), ...(q.get('type') ? { type: q.get('type')! } : {}), ...(q.get('difficulty') ? { difficulty: Number(q.get('difficulty')) } : {}) },
    orderBy: [{ levelId: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  })
  return successResponse(rows)
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'curriculum', 'update')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ subjectId: z.string().min(1), levelId: z.string().nullish(), difficulty: z.number().int().min(1).max(3).default(2), skillIds: z.array(z.string()).max(10).optional(), question: quizQuestionSchema }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  const course = await prisma.academicSubject.findUnique({ where: { id: d.subjectId }, select: { id: true } })
  if (!course) return errors.notFound('Course')
  const { id: _id, type, textEn, textAr, points, ...rest } = d.question
  const row = await prisma.question.create({
    data: { subjectId: course.id, levelId: d.levelId ?? null, type: type!, textEn: textEn ?? '', textAr: textAr ?? '', points: points ?? 1, difficulty: d.difficulty ?? 2, skillIds: (d.skillIds ?? undefined) as never, data: rest as never, createdById: session.user.id },
  })
  return createdResponse(row, 'Question saved')
}
