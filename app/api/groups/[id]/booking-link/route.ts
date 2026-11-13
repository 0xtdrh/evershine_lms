/** GET /api/groups/[id]/booking-link — six phases 1-C: the group's booking link, its course page, and bookings that came from it. */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requirePermission, requireSession } from '@/lib/academic/api-helpers'
import { canSeeGroup } from '@/lib/places/server'
import { groupLinkStats } from '@/lib/bookings/links'

export async function GET(_r: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'family_accounts', 'read')
  if (denied) return denied
  const { id } = await params
  if (!(await canSeeGroup(session.user, id))) return errors.notFound('Group')
  return successResponse(await groupLinkStats(id))
}
