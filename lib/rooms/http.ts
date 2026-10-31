/** a02 batch 3: who may read / change a place's rooms (branch = campuses, partner place = partners; + the place). */

import type { Role } from '@prisma/client'
import { errors } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { allowsCampus, loadPlaces } from '@/lib/places/server'

export async function roomsGuard(campusId: string, action: 'read' | 'update') {
  const { session, error } = await requireSession()
  if (error || !session) return { err: error! }
  const c = await prisma.campus.findUnique({ where: { id: campusId }, select: { kind: true } })
  if (!c) return { err: errors.notFound('Place') }
  const resource = c.kind === 'PARTNER' ? 'partners' : 'campuses'
  if (!checkPermission(session.user.role as Role, resource, action) && !(action === 'read' && checkPermission(session.user.role as Role, 'class_sections', 'read'))) return { err: errors.forbidden() }
  if (!allowsCampus(await loadPlaces(session.user), campusId)) return { err: errors.forbidden('This place is not yours · المكان ده مش بتاعك') }
  return { session }
}
