/**
 * LMS L3: rubric library. GET ?subjectId= (curriculum:read) = rubrics for that course + the ones for every course.
 * POST (curriculum:update) { nameEn, nameAr?, subjectId?, criteria, kidStars? }.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { requirePermission, requireSession } from '@/lib/academic/api-helpers'
import { rubricCriteriaSchema, rubricMax } from '@/lib/assignments/rules'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'curriculum', 'read')
  if (denied) return denied
  const subjectId = request.nextUrl.searchParams.get('subjectId')
  const rows = await prisma.rubric.findMany({
    where: { isActive: true, ...(subjectId ? { OR: [{ subjectId }, { subjectId: null }] } : {}) },
    orderBy: [{ nameEn: 'asc' }],
  })
  return successResponse(rows.map((r) => ({ ...r, maxPoints: rubricMax(r.criteria as never) })))
}

const rubricBody = z.object({
  nameEn: z.string().trim().min(1).max(120), nameAr: z.string().trim().max(120).default(''),
  subjectId: z.string().nullish(), criteria: rubricCriteriaSchema, kidStars: z.boolean().default(false),
})

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'curriculum', 'update')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = rubricBody.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  const r = await prisma.rubric.create({ data: { nameEn: d.nameEn!, nameAr: d.nameAr ?? '', kidStars: !!d.kidStars, subjectId: d.subjectId ?? null, criteria: d.criteria as never, createdById: session.user.id } })
  return createdResponse(r, 'Rubric saved')
}
