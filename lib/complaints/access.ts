/** Phase D: who is looking at complaints — the sender (student / parent) or a handler (staff). Server-only. */

import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { campusScope } from '@/lib/academic/api-helpers'

export const PORTAL_ROLES = ['STUDENT', 'PARENT', 'GUARDIAN']
export const isPortal = (role: string) => PORTAL_ROLES.includes(role)

export function staffScope(user: { role: string; campusId?: string | null }) {
  const role = user.role as Role
  return {
    canRead: checkPermission(role, 'complaints', 'read'),
    canHandle: checkPermission(role, 'complaints', 'update'),
    canCreate: checkPermission(role, 'complaints', 'create'),
    canReport: checkPermission(role, 'complaints', 'export'),
    campusId: campusScope(role, user.campusId, null) ?? null,
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

/** May this staff user see this complaint (branch)? */
export const staffSees = (scope: { campusId: string | null }, c: { campusId: string | null }) => !scope.campusId || !c.campusId || c.campusId === scope.campusId
