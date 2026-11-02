/** a02 M3 batch 3, instructor: GET — his One-to-Ones and their coming sessions. POST { groupId, date, reason } — he cannot come: the session is cancelled and the family is asked. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { oneToOneError } from '@/lib/one-to-one/http'
import { apologize, teacherSessions } from '@/lib/one-to-one/sessions'

export const dynamic = 'force-dynamic'

const schema = z.object({ groupId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(2).max(300) })

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (session.user.role !== 'TEACHER') return errors.forbidden()
  return successResponse(await teacherSessions(session.user.id))
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (session.user.role !== 'TEACHER') return errors.forbidden()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try {
    await apologize(session.user.id, parsed.data.groupId, parsed.data.date, parsed.data.reason)
    return successResponse({ done: true })
  } catch (e) { return oneToOneError(e) }
}
