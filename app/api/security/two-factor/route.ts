/** Security part 2. GET — my two-step status. POST { action: 'start' } — a new app secret + QR; { action: 'confirm', code } — turn it on (spare codes shown once). */

import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { confirmSetup, myStatus, startSetup } from '@/lib/security/two-factor'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  return successResponse(await myStatus(session.user.id))
}

const schema = z.discriminatedUnion('action', [z.object({ action: z.literal('start') }), z.object({ action: z.literal('confirm'), code: z.string().min(6).max(10) })])

export async function POST(request: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try {
    if (parsed.data.action === 'start') return successResponse(await startSetup(session.user.id))
    return successResponse(await confirmSetup(session.user.id, (parsed.data as { code: string }).code))
  } catch (e) {
    return errors.badRequest((e as Error).message)
  }
}
