/** GET / PUT /api/rooms/settings — a02 batch 3: how long a session lasts when checking room clashes (minutes). Admins save. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/lib/academic/api-helpers'
import { errors, successResponse } from '@/lib/api-response'
import { getRoomsSettings, saveRoomsSettings } from '@/lib/rooms/engine'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  return successResponse(await getRoomsSettings())
}

export async function PUT(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)) return errors.forbidden()
  const parsed = z.object({ sessionMinutes: z.number().int().min(15).max(300) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveRoomsSettings(parsed.data, session.user.id), 'Saved · اتحفظ')
}
