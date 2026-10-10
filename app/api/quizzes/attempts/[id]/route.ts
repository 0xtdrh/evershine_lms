/** LMS L4: save the answers of a running try (PUT { answers, submit }). The deadline is checked on the server. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, errorResponse, successResponse } from '@/lib/api-response'
import { saveAttempt } from '@/lib/quizzes/engine'
import { portalLessonViewer } from '@/lib/lms/api'

const answer = z.union([
  z.string().max(10000), z.number(), z.array(z.string().max(500)).max(30), z.record(z.string(), z.string().max(100)),
  z.object({ code: z.string().max(50000), results: z.array(z.object({ id: z.string().max(40), passed: z.boolean() })).max(30) }), z.null(),
])

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ answers: z.record(z.string(), answer), submit: z.boolean() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const { v, err } = await portalLessonViewer(null)
  if (err) return err
  if (v!.asParent) return errors.forbidden()
  const o = await saveAttempt(v!.studentId, id, parsed.data.answers as never, parsed.data.submit!)
  if (!o.ok) return o.code === 'NOT_FOUND' ? errors.notFound('Attempt') : errorResponse(o.code!, o.message!, 409)
  return successResponse(o.value, parsed.data.submit ? 'Handed in' : 'Saved')
}
