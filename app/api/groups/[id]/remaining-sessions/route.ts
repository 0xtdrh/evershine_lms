/**
 * GET /api/groups/[id]/remaining-sessions
 * The group's still-upcoming sessions in its current cycle, each tagged
 * with a session number (e.g. "Session 3 of 4") — used so a teacher can
 * pick exactly one specific upcoming session to excuse, instead of only
 * "today".
 */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { getRemainingCycleSessions } from '@/lib/teachers/schedule'
import type { Role } from '@prisma/client'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'teachers', 'read')
  if (denied) return denied

  const { id } = await params
  const sessions = await getRemainingCycleSessions(id)
  if (sessions.length === 0) return errors.notFound('No remaining sessions found for this group\u2019s current cycle')

  return successResponse(sessions)
}
