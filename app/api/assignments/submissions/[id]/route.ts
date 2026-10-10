/**
 * LMS L3: one hand-in for the person grading it (instructor / substitute / branch manager / admins).
 * GET = the work + correct answers + automatic detail. POST { action: grade | return, points | stars | rubricPicks,
 * autoOverride + overrideReason, feedback }.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, errorResponse, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { gradeSubmission, staffSubmission } from '@/lib/assignments/engine'
import { canManageGroupLessons } from '@/lib/lms/engine'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const data = await staffSubmission(id)
  if (!data) return errors.notFound('Submission')
  if (!(await canManageGroupLessons({ id: session.user.id, role: session.user.role, campusId: session.user.campusId }, data.classSectionId))) return errors.forbidden()
  return successResponse(data)
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { session, error } = await requireSession()
  if (error || !session) return error!
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({
    action: z.enum(['grade', 'return']),
    points: z.number().nullish(), stars: z.number().int().nullish(),
    rubricPicks: z.record(z.string(), z.number().int().min(0).max(10)).optional(),
    autoOverride: z.number().nullish(), overrideReason: z.string().max(500).nullish(),
    feedback: z.string().max(5000).nullish(),
  }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const o = await gradeSubmission({ id: session.user.id, role: session.user.role, campusId: session.user.campusId }, id, parsed.data as never)
  if (!o.ok) return o.code === 'FORBIDDEN' ? errors.forbidden(o.message) : o.code === 'NOT_FOUND' ? errors.notFound('Submission') : o.code === 'BAD_STATUS' ? errorResponse('BAD_STATUS', o.message!, 409) : errors.badRequest(o.message!)
  return successResponse(o.value, o.value!.status === 'RETURNED' ? 'Sent back for changes' : 'Graded')
}
