/**
 * LMS L4: a group's quizzes for the people who run it (not secretaries). GET = every quiz with each student's score,
 * open / closed, tries waiting for review. PATCH { blockId, open, closesAt? } = open / close a quiz (e.g. the final exam).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { groupQuizzes, setQuizWindow } from '@/lib/quizzes/engine'
import { canManageGroupLessons } from '@/lib/lms/engine'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!(await canManageGroupLessons({ id: session.user.id, role: session.user.role, campusId: session.user.campusId }, id))) return errors.forbidden()
  return successResponse(await groupQuizzes(id))
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { session, error } = await requireSession()
  if (error || !session) return error!
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ blockId: z.string().min(1), open: z.boolean(), closesAt: z.string().datetime().nullish() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const o = await setQuizWindow({ id: session.user.id, role: session.user.role, campusId: session.user.campusId }, id, parsed.data.blockId!, parsed.data.open!, parsed.data.closesAt ? new Date(parsed.data.closesAt) : null)
  if (!o.ok) return o.code === 'FORBIDDEN' ? errors.forbidden() : errors.notFound('Quiz')
  return successResponse(null, parsed.data.open ? 'Quiz opened' : 'Quiz closed')
}
