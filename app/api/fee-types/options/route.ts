/** GET /api/fee-types/options — FIN-2: places, partners, tracks, courses, levels, groups for the fee exception picker (inside the person's places). */

import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { successResponse } from '@/lib/api-response'
import { loadPlaces } from '@/lib/places/server'
import { campusWhere, groupWhere } from '@/lib/places/rules'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role, 'finance_settings', 'update')) return errors.forbidden()
  const places = await loadPlaces(session.user)
  const [campuses, partners, tracks, courses, levels, groups] = await Promise.all([
    prisma.campus.findMany({ where: { isActive: true, ...campusWhere(places, 'id') }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.partner.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.track.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.academicSubject.findMany({ where: { isActive: true, trackId: { not: null } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.level.findMany({ where: { isActive: true }, select: { id: true, name: true, subject: { select: { name: true } } }, orderBy: [{ subjectId: 'asc' }, { order: 'asc' }] }),
    prisma.classSection.findMany({ where: { status: 'ACTIVE', isActive: true, levelId: { not: null }, ...groupWhere(places) }, select: { id: true, className: true, sectionName: true }, orderBy: { className: 'asc' } }),
  ])
  return successResponse({
    PARTNER: partners, CAMPUS: campuses, TRACK: tracks, COURSE: courses,
    LEVEL: levels.map((l) => ({ id: l.id, name: `${l.subject?.name ?? ''} — ${l.name}` })),
    GROUP: groups.map((g) => ({ id: g.id, name: `${g.className} ${g.sectionName}`.trim() })),
  })
}
