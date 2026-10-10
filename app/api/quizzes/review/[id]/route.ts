/**
 * LMS L4: one try for the instructor (questions with answers + the student's answers + scan of a paper exam).
 * POST { points: { questionId: n }, feedback } confirms written-code answers / adds feedback.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, errorResponse, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { reviewAttempt, staffAttempt } from '@/lib/quizzes/engine'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const a = await staffAttempt({ id: session.user.id, role: session.user.role, campusId: session.user.campusId }, id)
  if (!a) return errors.notFound('Attempt')
  return successResponse(a)
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { session, error } = await requireSession()
  if (error || !session) return error!
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ points: z.record(z.string(), z.number()).default({}), feedback: z.string().max(5000).nullish() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const o = await reviewAttempt({ id: session.user.id, role: session.user.role, campusId: session.user.campusId }, id, parsed.data.points ?? {}, parsed.data.feedback ?? null)
  if (!o.ok) return o.code === 'FORBIDDEN' ? errors.forbidden(o.message) : o.code === 'NOT_FOUND' ? errors.notFound('Attempt') : errorResponse(o.code!, o.message!, 409)
  return successResponse(o.value, 'Saved')
}
