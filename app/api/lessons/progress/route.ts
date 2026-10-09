/** LMS L2: the student ticks a lesson item as done (or not). POST { groupId, blockId, done }. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { setProgress } from '@/lib/lms/engine'
import { portalLessonViewer } from '@/lib/lms/api'

export async function POST(request: NextRequest) {
  const { v, err } = await portalLessonViewer(null)
  if (err) return err
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ groupId: z.string().min(1), blockId: z.string().min(1), done: z.boolean() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const o = await setProgress(v!.studentId, parsed.data.groupId!, parsed.data.blockId!, parsed.data.done!)
  if (!o.ok) return o.code === 'NOT_FOUND' ? errors.notFound('Content') : errors.forbidden(o.message)
  return successResponse(null, 'Saved')
}
