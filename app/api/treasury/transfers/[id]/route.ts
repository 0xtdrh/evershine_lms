/** PATCH /api/treasury/transfers/[id] { action: approve | reject | cancel } — FIN-1 (another person approves). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { treasuryError, treasuryUser } from '@/lib/treasury/http'
import { decideTransfer } from '@/lib/treasury/engine'

const schema = z.object({ action: z.enum(['approve', 'reject', 'cancel']) })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await treasuryUser('read')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { await decideTransfer(u.user, (await params).id, (parsed.data as { action: 'approve' | 'reject' | 'cancel' }).action); return successResponse({ ok: true }) } catch (e) { return treasuryError(e) }
}
