/** PATCH /api/treasury/transfers/[id] { action: approve | reject | cancel } — FIN-1 (another person approves). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { treasuryError, treasuryUser } from '@/lib/treasury/http'
import { decideTransfer } from '@/lib/treasury/engine'
import { withMonthLock } from '@/lib/month-close/with-lock'

const schema = z.object({ action: z.enum(['approve', 'reject', 'cancel']) })

async function PATCH_(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await treasuryUser('read')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { await decideTransfer(u.user, (await params).id, (parsed.data as { action: 'approve' | 'reject' | 'cancel' }).action); return successResponse({ ok: true }) } catch (e) { return treasuryError(e) }
}

// a03: a write into a closed month answers 409 with the reason
export const PATCH = withMonthLock(PATCH_)
