/**
 * LMS L3 batch 2: projects gallery — approved hand-ins the signed-in person may see (students / parents by the group's
 * gallery rule; staff with curriculum:read see all). GET ?group=<id> to show one group.
 */

import { NextRequest } from 'next/server'
import { errors, errorResponse, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { galleryItems, galleryViewer } from '@/lib/assignments/gallery'
import { isModuleOn } from '@/lib/platform/settings'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const v = await galleryViewer({ id: session.user.id, role: session.user.role })
  if (!v) return errors.forbidden()
  if (!v.staff && !(await isModuleOn('lms'))) return errorResponse('MODULE_OFF', 'Lessons are not switched on yet', 403)
  return successResponse(await galleryItems(v, { groupId: request.nextUrl.searchParams.get('group') }))
}
