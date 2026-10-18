/** POST /api/activity/ping — 2026-10-18 usage: the open dashboard says "still here" every minute (lib/activity/usage.ts). */

import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { recordPing } from '@/lib/activity/usage'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return errors.unauthorized()
  await recordPing(session.user.id, String(session.user.role ?? ''))
  return successResponse({ ok: true })
}
