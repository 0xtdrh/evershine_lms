/**
 * GET /api/waiting-list?campusId=&subjectId=
 *
 * Waiting List page data (see lib/waiting-list/build.ts): one list per
 * course/level, students waiting for an upcoming group (by group), students
 * not in any group, students who finished and did not continue (with the
 * level they should join next), and recorded wishes.
 */

import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { buildWaitingList } from '@/lib/waiting-list/build'
import type { Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'waiting_list', 'read')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const campusId = campusScope(role, session.user.campusId, searchParams.get('campusId') || null)
  const subjectId = searchParams.get('subjectId') || undefined

  const data = await buildWaitingList({ campusId, subjectId })
  return successResponse(data)
}
