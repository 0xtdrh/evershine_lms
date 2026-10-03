/** DELETE /api/holidays/[id] — remove a holiday (sessions on that day come back). */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'holidays', 'delete')
  if (denied) return denied
  const { id } = await params
  const h = await prisma.holiday.findUnique({ where: { id } })
  if (!h) return errors.notFound('Holiday')
  const ownCampus = campusScope(role, session.user.campusId, null)
  if (ownCampus && h.campusId !== ownCampus) return errors.forbidden('This holiday belongs to another branch or the whole company')
  await prisma.holiday.delete({ where: { id } })
  return successResponse({ deleted: true }, 'Holiday removed')
}
