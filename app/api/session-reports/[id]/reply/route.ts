/** POST /api/session-reports/[id]/reply { studentId, text } — the parent answers under a sent report (goes to the follow-ups). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { errorResponse, errors, successResponse } from '@/lib/api-response'
import { replyToReport } from '@/lib/session-reports/engine'

export const dynamic = 'force-dynamic'
const body = z.object({ studentId: z.string().min(1).max(40), text: z.string().trim().min(2).max(1000) })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const r = await replyToReport(session.user, (await params).id, parsed.data.studentId, parsed.data.text)
  if (!r.ok) return errorResponse(r.code ?? 'REFUSED', r.message ?? 'Refused', r.code === 'FORBIDDEN' ? 403 : r.code === 'NOT_FOUND' ? 404 : 409)
  return successResponse({ ok: true })
}
