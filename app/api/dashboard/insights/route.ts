/** GET /api/dashboard/insights — phase C: the key numbers for the signed-in user's role (branch-scoped). */

import { onePlace } from '@/lib/places/rules'
import { requestPlaces } from '@/lib/places/server'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { cached } from '@/lib/cache/ttl'
import { requireSession } from '@/lib/academic/api-helpers'
import { getTeacherByUserId, getTeacherClassSectionIds } from '@/lib/academic/teacher-scope'
import { managerMetrics, accountantMetrics, secretaryMetrics, teacherMetrics } from '@/lib/insights/insights'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const campusId = (onePlace(await requestPlaces(session.user), null) ?? undefined)
  // load test 22/11: the same numbers for everyone with the same role + place — kept 60 s (the card refreshes every 5 min)
  const key = `insights:${role}:${campusId ?? 'ALL'}`
  if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'BRANCH_MANAGER') return successResponse({ role, metrics: await cached(key, 60_000, () => managerMetrics(campusId)) })
  if (role === 'ACCOUNTANT') return successResponse({ role, metrics: await cached(key, 60_000, () => accountantMetrics(campusId)) })
  if (role === 'SECRETARY') return successResponse({ role, metrics: await cached(key, 60_000, () => secretaryMetrics(campusId)) })
  if (role === 'TEACHER') {
    const t = await getTeacherByUserId(session.user.id)
    if (!t) return errors.forbidden()
    const all = await getTeacherClassSectionIds(t.id)
    const active = (await prisma.classSection.findMany({ where: { id: { in: all }, status: 'ACTIVE', levelId: { not: null } }, select: { id: true } })).map((g) => g.id)
    return successResponse({ role, metrics: await teacherMetrics(t.id, active) })
  }
  return successResponse({ role, metrics: [] })
}
