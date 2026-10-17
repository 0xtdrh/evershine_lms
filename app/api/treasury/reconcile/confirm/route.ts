/**
 * POST /api/treasury/reconcile/confirm — FIN-3: { accountId, pairs: [{ moveId, bankRef }] } marks movements as matched
 * with the bank; { accountId, undo: moveId } takes one back.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { treasuryError, treasuryUser } from '@/lib/treasury/http'
import { confirmReconcile, undoReconcile } from '@/lib/treasury/reconcile'

const schema = z.object({
  accountId: z.string().min(1),
  pairs: z.array(z.object({ moveId: z.string().min(1), bankRef: z.string().max(100).nullish() })).max(2000).optional(),
  undo: z.string().min(1).optional(),
})

export async function POST(request: NextRequest) {
  const u = await treasuryUser('approve')
  if ('error' in u) return u.error
  const body = schema.safeParse(await request.json().catch(() => null))
  if (!body.success || (!body.data.pairs && !body.data.undo)) return errors.badRequest('Invalid request')
  try {
    return successResponse(body.data.undo ? await undoReconcile(u.user, body.data.accountId, body.data.undo) : await confirmReconcile(u.user, body.data.accountId, (body.data.pairs ?? []) as { moveId: string; bankRef?: string | null }[]))
  } catch (e) { return treasuryError(e) }
}
