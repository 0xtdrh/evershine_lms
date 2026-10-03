/**
 * Phase C ratings for parents.
 * GET  — per child: sessions to rate (only for young children, the parent answers for them) + month/level surveys to answer
 * POST { type: 'session', studentId, classSectionId, sessionDate, rating 1..4, comment? }
 *      { type: 'survey',  studentId, classSectionId, sessionsRating, teacherRating, companyRating (1..5), comment? }
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { assertGuardianAccessToStudent, getChildrenForGuardianUser } from '@/lib/academic/guardian'
import { isYoungChild, pendingSessionRatings, pendingSurveys, rateSession, submitSurvey } from '@/lib/ratings/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return errors.forbidden()
  const children = await getChildrenForGuardianUser(session.user.id)
  const out = await Promise.all(children.map(async (c) => {
    const young = await isYoungChild(c.id)
    return {
      studentId: c.id,
      name: `${c.firstName} ${c.lastName}`,
      young,
      sessions: young ? await pendingSessionRatings(c.id) : [],
      surveys: await pendingSurveys(c.id),
    }
  }))
  return successResponse({ children: out })
}

const sessionSchema = z.object({
  type: z.literal('session'),
  studentId: z.string().min(1),
  classSectionId: z.string().min(1),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rating: z.number().int().min(1).max(4),
  comment: z.string().trim().max(500).optional().nullable(),
})
const surveySchema = z.object({
  type: z.literal('survey'),
  studentId: z.string().min(1),
  classSectionId: z.string().min(1),
  sessionsRating: z.number().int().min(1).max(5),
  teacherRating: z.number().int().min(1).max(5),
  companyRating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional().nullable(),
})

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return errors.forbidden()
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.union([sessionSchema, surveySchema]).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data as z.infer<typeof sessionSchema> | z.infer<typeof surveySchema>
  if (!(await assertGuardianAccessToStudent(session.user.id, d.studentId!))) return errors.forbidden('You can only rate for your own children')
  let r
  if (d.type === 'session') {
    const s = d as z.infer<typeof sessionSchema>
    if (!(await isYoungChild(s.studentId!))) return errors.forbidden('Your child rates the sessions from their own portal')
    r = await rateSession({ studentId: s.studentId!, classSectionId: s.classSectionId!, sessionDate: s.sessionDate!, rating: s.rating!, comment: s.comment, userId: session.user.id, byRole: 'PARENT' })
  } else {
    const s = d as z.infer<typeof surveySchema>
    r = await submitSurvey({ studentId: s.studentId!, classSectionId: s.classSectionId!, sessionsRating: s.sessionsRating!, teacherRating: s.teacherRating!, companyRating: s.companyRating!, comment: s.comment, userId: session.user.id })
  }
  if (!r.ok) return r.code === 400 ? errors.badRequest(r.message) : errors.conflict(r.message)
  return createdResponse({ ok: true }, 'Thank you!')
}
