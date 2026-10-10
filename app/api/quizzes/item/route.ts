/**
 * LMS L4: one quiz for a student. GET ?g=<groupId>&b=<blockId>[&s=<childId> for parents] = tries, results, the running
 * try (questions without answers). POST { groupId, blockId } = start / resume a try (students only).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, errorResponse, successResponse } from '@/lib/api-response'
import { startAttempt, studentQuiz } from '@/lib/quizzes/engine'
import { clientIp, portalLessonViewer } from '@/lib/lms/api'
import { prisma } from '@/lib/prisma'
import { getLmsSettings } from '@/lib/lms/settings'
import { ageOn, cairoYmd } from '@/lib/dates/cairo'

const outcomeError = (o: { code?: string; message?: string }) =>
  o.code === 'NOT_FOUND' ? errors.notFound('Quiz')
    : o.code === 'FORBIDDEN' ? errors.forbidden(o.message)
      : ['NOT_OPEN', 'CLOSED', 'NO_ATTEMPTS', 'LOCKED', 'EMPTY'].includes(o.code ?? '') ? errorResponse(o.code!, o.message ?? 'Not allowed', 409)
        : errors.badRequest(o.message ?? 'Invalid')

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const { v, err } = await portalLessonViewer(q.get('s'))
  if (err) return err
  const g = q.get('g'), b = q.get('b')
  if (!g || !b) return errors.badRequest('g and b are required')
  const r = (await studentQuiz(v!.studentId, g, b)) as { ok: boolean; code?: string; message?: string; value?: { active?: unknown } }
  if (!r.ok) return outcomeError(r)
  const [student, settings] = await Promise.all([prisma.student.findUnique({ where: { id: v!.studentId }, select: { dateOfBirth: true } }), getLmsSettings()])
  const age = student?.dateOfBirth ? ageOn(student.dateOfBirth, cairoYmd()) : null
  // parents see results, never a running try
  return successResponse({ ...r.value, ...(v!.asParent ? { active: null } : {}), asParent: v!.asParent, kidMode: age !== null && age <= settings.kidModeMaxAge })
}

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ groupId: z.string().min(1), blockId: z.string().min(1) }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const { v, err } = await portalLessonViewer(null)
  if (err) return err
  if (v!.asParent) return errors.forbidden('Only the student takes the quiz')
  const o = await startAttempt(v!.studentId, parsed.data.groupId!, parsed.data.blockId!, { ip: clientIp(request), userAgent: request.headers.get('user-agent') })
  if (!o.ok) return outcomeError(o)
  return successResponse(o.value, 'Started')
}
