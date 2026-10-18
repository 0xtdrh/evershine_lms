/**
 * 2026-10-18 lesson gates for the people who run the group (same people as the group's lessons panel).
 * GET ?session=N → students held back by session N's gate. POST { studentId, sessionNumber, open } → the instructor
 * opens (or takes back) one session for one student (only when LMS settings allow it).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { canManageGroupLessons, groupGateStatus, setStudentLessonUnlock } from '@/lib/lms/engine'

type Ctx = { params: Promise<{ id: string }> }

async function guard(id: string) {
  const { session, error } = await requireSession()
  if (error || !session) return { err: error! }
  if (!(await canManageGroupLessons({ id: session.user.id, role: session.user.role, campusId: session.user.campusId }, id))) return { err: errors.forbidden() }
  return { session }
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const n = Number(request.nextUrl.searchParams.get('session'))
  if (!Number.isInteger(n) || n < 1) return errors.badRequest('Choose a session')
  const data = await groupGateStatus(id, n)
  if (!data) return errors.notFound('Group')
  return successResponse(data)
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params
  const g = await guard(id)
  if (g.err) return g.err
  const parsed = z.object({ studentId: z.string().min(1), sessionNumber: z.number().int().min(1).max(500), open: z.boolean() }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const o = await setStudentLessonUnlock(id, parsed.data.studentId, parsed.data.sessionNumber, parsed.data.open, g.session!.user.id)
  if (!o.ok) return o.code === 'FORBIDDEN' ? errors.forbidden(o.message) : errors.badRequest(o.message ?? 'Not allowed')
  return successResponse({ ok: true }, parsed.data.open ? 'Opened for this student' : 'Back to the gate')
}
