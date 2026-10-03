/**
 * GET /api/ratings/overview?days=90 — phase C: averages per instructor, the latest
 * parent surveys and the low session ratings, with names (ratings:read).
 * GET /api/ratings/overview?mine=1 — an instructor's own averages (anonymous).
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getTeacherByUserId } from '@/lib/academic/teacher-scope'
import { feedbackOverview, teacherAverages } from '@/lib/ratings/engine'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const sp = new URL(request.url).searchParams
  if (sp.get('mine') === '1') {
    if (role !== 'TEACHER') return errors.forbidden()
    const t = await getTeacherByUserId(session.user.id)
    if (!t) return errors.forbidden()
    return successResponse(await teacherAverages(t.id))
  }
  const denied = requirePermission(role, 'ratings', 'read')
  if (denied) return denied
  const days = Math.min(365, Math.max(7, Number(sp.get('days') ?? 90) || 90))
  return successResponse(await feedbackOverview({ campusId: campusScope(role, session.user.campusId, sp.get('campusId')), sinceDays: days }))
}
