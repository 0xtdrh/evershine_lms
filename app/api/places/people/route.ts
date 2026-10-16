/**
 * Partners part 1-B2: GET /api/places/people?campusIds=a,b — groups, students and instructors of those places (only the
 * ones among the person's places). Used by the branch page and the partner page.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { allowsCampus, loadPlaces } from '@/lib/places/server'
import { placePeople } from '@/lib/places/people'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'class_sections', 'read')
  if (denied) return denied
  const places = await loadPlaces(session.user)
  const ids = (new URL(request.url).searchParams.get('campusIds') ?? '').split(',').map((x) => x.trim()).filter(Boolean).filter((c) => allowsCampus(places, c))
  return successResponse(await placePeople([...new Set(ids)].slice(0, 50)))
}
