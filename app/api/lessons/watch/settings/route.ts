/** GET / PUT /api/lessons/watch/settings — six phases 2: the "watched" percent and the days without watching that alert staff. */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { watchSettingsSchema } from '@/lib/videos/watch'
import { getWatchSettings, saveWatchSettings } from '@/lib/videos/watch-engine'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  return successResponse(await getWatchSettings())
}

export async function PUT(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!['SUPER_ADMIN', 'ADMIN'].includes(session.user.role)) return errors.forbidden()
  const parsed = watchSettingsSchema.partial().safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveWatchSettings(session.user.id, parsed.data))
}
