/** POST /api/session-reports/[id]/release { studentId } — a manager lets the family see this student's low ratings (session_reports:approve). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { errorResponse, errors, successResponse } from '@/lib/api-response'
import { releaseLowScores } from '@/lib/session-reports/engine'

export const dynamic = 'force-dynamic'
const body = z.object({ studentId: z.string().min(1).max(40) })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const r = await releaseLowScores(session.user, (await params).id, parsed.data.studentId)
  if (!r.ok) return errorResponse(r.code ?? 'REFUSED', r.message ?? 'Refused', r.code === 'FORBIDDEN' ? 403 : 404)
  return successResponse({ ok: true })
}
