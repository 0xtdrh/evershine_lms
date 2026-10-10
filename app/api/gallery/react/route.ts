/** LMS L3 batch 2: add / remove an emoji reaction on a gallery project. POST { submissionId, emoji }. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { galleryViewer, toggleReaction } from '@/lib/assignments/gallery'

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const v = await galleryViewer({ id: session.user.id, role: session.user.role })
  if (!v) return errors.forbidden()
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ submissionId: z.string().min(1), emoji: z.string().min(1).max(8) }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const o = await toggleReaction(v, parsed.data.submissionId!, parsed.data.emoji!)
  if (!o.ok) return o.message === 'Not found' ? errors.notFound('Project') : errors.badRequest(o.message!)
  return successResponse(null)
}
