/** Phase D: who is looking at complaints — the sender (student / parent) or a handler (staff). Server-only. */

import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { requestPlaces } from '@/lib/places/server'
import { allowsCampus, type Places } from '@/lib/places/rules'

export const PORTAL_ROLES = ['STUDENT', 'PARENT', 'GUARDIAN']
export const isPortal = (role: string) => PORTAL_ROLES.includes(role)

/** What a staff user may do with complaints, and their places (M0). */
export async function staffScope(user: { id: string; role: string; campusId?: string | null }) {
  const role = user.role as Role
  return {
    places: await requestPlaces(user),
    canRead: checkPermission(role, 'complaints', 'read'),
    canHandle: checkPermission(role, 'complaints', 'update'),
    canCreate: checkPermission(role, 'complaints', 'create'),
    canReport: checkPermission(role, 'complaints', 'export'),
  }
}

/** Students the sender may write about: a parent's children, or the student themself. */
export async function senderStudents(user: { id: string; role: string }) {
  if (user.role === 'STUDENT') {
    const s = await prisma.student.findFirst({ where: { userId: user.id }, select: { id: true, firstName: true, lastName: true } })
    return s ? [s] : []
  }
  const g = await prisma.guardian.findUnique({ where: { userId: user.id }, select: { students: { select: { id: true, firstName: true, lastName: true } } } })
  return g?.students ?? []
}

/** May this staff user see this complaint? (one of their places; a complaint without a place is seen by all) */
export const staffSees = (scope: { places: Places }, c: { campusId: string | null }) => !c.campusId || allowsCampus(scope.places, c.campusId)

/** Complaints where for a staff user's places. */
export const complaintWhere = (scope: { places: Places }) =>
  scope.places.all ? {} : { AND: [{ OR: [{ campusId: { in: scope.places.campusIds } }, { campusId: null }] }] }
