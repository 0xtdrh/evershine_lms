/** GET /api/groups/[id]/watch — six phases 2: lessons × students of a group — percent / minutes of each video watched. Staff (their places) and the group's instructors. */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requirePermission, requireSession } from '@/lib/academic/api-helpers'
import { canSeeGroup } from '@/lib/places/server'
import { groupWatchReport } from '@/lib/videos/watch-engine'

export const dynamic = 'force-dynamic'

export async function GET(_r: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (session.user.role !== 'TEACHER') {
    const denied = requirePermission(session.user.role as Role, 'class_sections', 'read')
    if (denied) return denied
  }
  const { id } = await params
  if (!(await canSeeGroup(session.user, id))) return errors.notFound('Group')
  return successResponse(await groupWatchReport(id))
}
