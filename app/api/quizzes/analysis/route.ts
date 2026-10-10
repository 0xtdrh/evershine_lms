/** LMS L4: item analysis of a quiz (?b=<blockId>[&g=<groupId>]) — hardest questions, most chosen wrong answer. */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { quizAnalysis } from '@/lib/quizzes/engine'
import { canManageGroupLessons } from '@/lib/lms/engine'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const b = request.nextUrl.searchParams.get('b'), g = request.nextUrl.searchParams.get('g')
  if (!b) return errors.badRequest('b is required')
  const user = { id: session.user.id, role: session.user.role, campusId: session.user.campusId }
  // one group: the people who run it; all groups: managers with curriculum:approve
  if (g ? !(await canManageGroupLessons(user, g)) : !checkPermission(session.user.role as Role, 'curriculum', 'approve')) return errors.forbidden()
  return successResponse(await quizAnalysis(g, b))
}
