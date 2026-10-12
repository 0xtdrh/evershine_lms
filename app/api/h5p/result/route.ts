/** L5: POST { groupId, blockId, score?, maxScore?, completed? } — the student's H5P result (sent by the lesson page). */

import { z } from 'zod'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { saveResult } from '@/lib/h5p/engine'

const body = z.object({ groupId: z.string().min(1), blockId: z.string().min(1), score: z.number().nullable().optional(), maxScore: z.number().nullable().optional(), completed: z.boolean().optional() })

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const r = await saveResult({ id: session.user.id, role: session.user.role }, parsed.data as Parameters<typeof saveResult>[1])
  if (!r.ok) return r.code === 'NOT_FOUND' ? errors.notFound('Activity') : errors.forbidden(r.message)
  return successResponse({ saved: true })
}
