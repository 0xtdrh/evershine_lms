/**
 * GET /api/announcements/options — what the "new announcement" form may offer this sender: places, partners, tracks,
 * courses, levels and groups inside their places (an instructor: only their groups), whether they publish at once
 * or wait for approval, and the announcement settings.
 */

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { loadPlaces } from '@/lib/places/server'
import { campusWhere, groupWhere } from '@/lib/places/rules'
import { getTeacherByUserId, getTeacherClassSectionIds } from '@/lib/academic/teacher-scope'
import { getAnnouncementSettings } from '@/lib/announcements/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role
  if (!checkPermission(role, 'announcements', 'create')) return errors.forbidden()
  const settings = await getAnnouncementSettings()
  const canApprove = checkPermission(role, 'announcements', 'approve')
  const groupSelect = { id: true, className: true, sectionName: true, campus: { select: { name: true } } }
  const label = (g: { className: string; sectionName: string; campus: { name: string } | null }) => `${g.className} ${g.sectionName}`.trim() + (g.campus ? ` · ${g.campus.name}` : '')

  if (role === 'TEACHER') {
    const t = await getTeacherByUserId(session.user.id)
    const ids = t ? await getTeacherClassSectionIds(t.id) : []
    const groups = await prisma.classSection.findMany({ where: { id: { in: ids }, status: 'ACTIVE', isActive: true }, select: groupSelect, orderBy: { className: 'asc' } })
    return successResponse({ allPlaces: false, teacher: true, canApprove, settings, campuses: [], partners: [], tracks: [], courses: [], levels: [], groups: groups.map((g) => ({ id: g.id, name: label(g) })) })
  }

  const places = await loadPlaces(session.user)
  const [campuses, groups, tracks, courses, levels] = await Promise.all([
    prisma.campus.findMany({ where: { isActive: true, ...campusWhere(places, 'id') }, select: { id: true, name: true, partnerId: true }, orderBy: { name: 'asc' } }),
    prisma.classSection.findMany({ where: { status: 'ACTIVE', isActive: true, levelId: { not: null }, ...groupWhere(places) }, select: groupSelect, orderBy: { className: 'asc' } }),
    prisma.track.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.academicSubject.findMany({ where: { isActive: true, trackId: { not: null } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.level.findMany({ where: { isActive: true }, select: { id: true, name: true, subject: { select: { name: true } } }, orderBy: [{ subjectId: 'asc' }, { order: 'asc' }] }),
  ])
  const partnerIds = [...new Set(campuses.map((c) => c.partnerId).filter((x): x is string => !!x))]
  const partners = partnerIds.length ? await prisma.partner.findMany({ where: { id: { in: partnerIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : []
  return successResponse({
    allPlaces: places.all, teacher: false, canApprove, settings,
    campuses: campuses.map((c) => ({ id: c.id, name: c.name })),
    partners, tracks, courses,
    levels: levels.map((l) => ({ id: l.id, name: `${l.subject?.name ?? ''} — ${l.name}` })),
    groups: groups.map((g) => ({ id: g.id, name: label(g) })),
  })
}
