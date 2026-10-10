/**
 * LMS L4: paper exam result — the instructor types the score and attaches the scan(s).
 * POST { blockId, studentId, score, maxScore, scanFiles: [{ publicId, resourceType, format?, originalName? }], feedback? }.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { getBaseUploadFolder } from '@/lib/cloudinary'
import { paperResult } from '@/lib/quizzes/engine'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { session, error } = await requireSession()
  if (error || !session) return error!
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({
    blockId: z.string().min(1), studentId: z.string().min(1), score: z.number(), maxScore: z.number(),
    scanFiles: z.array(z.object({ publicId: z.string().min(1).max(300), resourceType: z.enum(['image', 'video', 'raw']), format: z.string().max(10).optional(), originalName: z.string().max(200).optional() })).max(10).default([]),
    feedback: z.string().max(5000).nullish(),
  }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  const o = await paperResult({ id: session.user.id, role: session.user.role, campusId: session.user.campusId }, id, d.blockId!, { studentId: d.studentId!, score: d.score!, maxScore: d.maxScore!, scanFiles: (d.scanFiles ?? []) as never, feedback: d.feedback }, `${getBaseUploadFolder()}/quiz-scans/${id}/`)
  if (!o.ok) return o.code === 'FORBIDDEN' ? errors.forbidden() : o.code === 'NOT_FOUND' ? errors.notFound('Quiz or student') : errors.badRequest(o.message!)
  return successResponse(o.value, 'Saved')
}
