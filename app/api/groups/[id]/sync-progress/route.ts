/**
 * POST /api/groups/[id]/sync-progress
 * Runs the group-progress check (see lib/groups/sync-progress.ts): flags
 * (not withdraws) unpaid students past the 50% checkpoint, and reports
 * whether the current cycle has reached its last session. Never closes a
 * cycle by itself — that's the manual /advance-cycle step. Safe to call
 * repeatedly.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { syncGroupProgress } from '@/lib/groups/sync-progress'
import type { Role } from '@prisma/client'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'read')
  if (denied) return denied

  const { id } = await params
  const group = await prisma.classSection.findUnique({ where: { id }, select: { campusId: true } })
  if (!group) return errors.notFound('Group')

  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && group.campusId !== campusId) return errors.forbidden()

  const result = await syncGroupProgress(id, session.user.id)

  return successResponse(result)
}
