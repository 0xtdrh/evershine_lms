/** DELETE /api/groups/[id]/extra-sessions/[sessionId] */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'update')
  if (denied) return denied
  const { id, sessionId } = await params
  const row = await prisma.extraSession.findUnique({ where: { id: sessionId }, select: { classSectionId: true } })
  if (!row || row.classSectionId !== id) return errors.notFound('Extra session')
  const g = await prisma.classSection.findUnique({ where: { id }, select: { campusId: true } })
  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && g?.campusId !== campusId) return errors.forbidden()
  await prisma.extraSession.delete({ where: { id: sessionId } })
  return successResponse({ deleted: true }, 'Extra session removed')
}
