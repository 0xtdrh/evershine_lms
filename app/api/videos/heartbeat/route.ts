/** a02 M4 batch 3: POST { token, end? } — the player is still open (keeps the device counted), or closed (frees it at once). */

import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { endViewing, heartbeat } from '@/lib/videos/engine'
import { videoError } from '@/lib/videos/http'

export async function POST(request: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  // sendBeacon sends text, so read the body by hand
  const parsed = z.object({ token: z.string().min(10).max(100), end: z.boolean().optional() }).safeParse(await request.text().then((t) => JSON.parse(t)).catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try {
    if (parsed.data.end) await endViewing(parsed.data.token, session.user.id)
    else await heartbeat(parsed.data.token, session.user.id)
    return successResponse({ ok: true })
  } catch (e) { return videoError(e) }
}
