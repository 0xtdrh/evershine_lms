/** PATCH /api/treasury/counts/[id] { action: approve | reject } — FIN-1: a manager approves a count difference. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { treasuryError, treasuryUser } from '@/lib/treasury/http'
import { decideCount } from '@/lib/treasury/engine'

const schema = z.object({ action: z.enum(['approve', 'reject']) })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await treasuryUser('approve')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { await decideCount(u.user, (await params).id, (parsed.data as { action: 'approve' | 'reject' }).action); return successResponse({ ok: true }) } catch (e) { return treasuryError(e) }
}
