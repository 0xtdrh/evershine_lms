/**
 * Phase C: the signed-in student rates their recent sessions with one tap.
 * GET  — sessions to rate (none for young children: their parent answers)
 * POST { classSectionId, sessionDate, rating 1..4, comment? }
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { isYoungChild, pendingSessionRatings, rateSession } from '@/lib/ratings/engine'

export const dynamic = 'force-dynamic'

async function me() {
  const session = await auth()
  if (!session?.user) return { err: errors.unauthorized() }
  if (session.user.role !== 'STUDENT') return { err: errors.forbidden() }
  const s = await prisma.student.findFirst({ where: { userId: session.user.id }, select: { id: true } })
  if (!s) return { err: errors.notFound('Student') }
  return { userId: session.user.id, studentId: s.id }
}

export async function GET() {
  const m = await me()
  if (m.err) return m.err
  if (await isYoungChild(m.studentId!)) return successResponse({ sessions: [], parentAnswers: true })
  return successResponse({ sessions: await pendingSessionRatings(m.studentId!), parentAnswers: false })
}

export async function POST(request: NextRequest) {
  const m = await me()
  if (m.err) return m.err
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({
    classSectionId: z.string().min(1),
    sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rating: z.number().int().min(1).max(4),
    comment: z.string().trim().max(500).optional().nullable(),
  }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  const r = await rateSession({ studentId: m.studentId!, classSectionId: d.classSectionId!, sessionDate: d.sessionDate!, rating: d.rating!, comment: d.comment, userId: m.userId!, byRole: 'STUDENT' })
  if (!r.ok) return r.code === 400 ? errors.badRequest(r.message) : errors.conflict(r.message)
  return createdResponse({ ok: true }, 'Thank you!')
}
