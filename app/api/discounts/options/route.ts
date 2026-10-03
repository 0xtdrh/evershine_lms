/**
 * GET /api/discounts/options — tracks, courses, levels and active groups, for
 * the "where does it apply" pickers of the discount screens.
 */

import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'discounts', 'read') && !checkPermission(role, 'discount_types', 'read') && !checkPermission(role, 'discounts', 'create') && !checkPermission(role, 'absence_excuses', 'update')) {
    return errors.forbidden()
  }
  const [tracks, courses, levels, groups] = await Promise.all([
    prisma.track.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.academicSubject.findMany({ select: { id: true, name: true, trackId: true }, orderBy: { name: 'asc' } }),
    prisma.level.findMany({ select: { id: true, name: true, subjectId: true, order: true }, orderBy: [{ subjectId: 'asc' }, { order: 'asc' }] }),
    prisma.classSection.findMany({
      where: { status: 'ACTIVE', isActive: true, levelId: { not: null } },
      select: { id: true, className: true, sectionName: true, level: { select: { name: true, subject: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
  ])
  return successResponse({
    tracks,
    courses,
    levels,
    groups: groups.map((g) => ({
      id: g.id,
      name: `${g.className} ${g.sectionName}`.trim(),
      detail: g.level ? `${g.level.subject?.name ?? ''} — ${g.level.name}` : '',
    })),
  })
}
