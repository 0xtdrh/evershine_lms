/** a02 M1 follow-up: POST { date, roomId | null } — one session of a group in another room (null = back to its usual room). class_sections:update + the group's place. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { errorResponse, errors, successResponse } from '@/lib/api-response'
import { canSeeGroup } from '@/lib/places/server'
import { setSessionRoom } from '@/lib/rooms/session-room'

const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), roomId: z.string().min(1).nullable() })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { id } = await params
  if (!checkPermission(session.user.role, 'class_sections', 'update')) return errors.forbidden()
  if (!(await canSeeGroup(session.user, id))) return errors.forbidden()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const problem = await setSessionRoom(id, parsed.data.date!, parsed.data.roomId ?? null, session.user.id)
  if (problem) return errorResponse('ROOM_PROBLEM', problem, 409)
  return successResponse({ saved: true })
}
