/** Security part 2. GET — staff accounts and their two-step status. POST { userId } — reset it (a lost phone). Super Admin only. */

import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { resetTwoFactor, staffStatus } from '@/lib/security/two-factor'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (session.user.role !== 'SUPER_ADMIN') return errors.forbidden()
  return successResponse(await staffStatus())
}

export async function POST(request: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (session.user.role !== 'SUPER_ADMIN') return errors.forbidden()
  const parsed = z.object({ userId: z.string().min(1) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { await resetTwoFactor(parsed.data.userId as string, session.user.id); return successResponse({ ok: true }) } catch (e) { return errors.badRequest((e as Error).message) }
}
