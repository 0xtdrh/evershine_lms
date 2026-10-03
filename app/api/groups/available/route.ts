/**
 * GET /api/groups/available?levelId=&excludeId=
 * Groups of the same course + level with a free seat (or no limit), to place a
 * waiting student (phase A). Branch-scoped like the other group lists.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { availableGroups } from '@/lib/groups/capacity'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'class_sections', 'read')
  if (denied) return denied
  const sp = new URL(request.url).searchParams
  const levelId = sp.get('levelId')
  if (!levelId) return errors.badRequest('levelId is required')
  const campusId = campusScope(role, session.user.campusId, null)
  return successResponse(await availableGroups(levelId, { campusId, excludeId: sp.get('excludeId') || undefined }))
}
