/** POST /api/cards/replace { kind, id, reason?, chargeFee? } — a lost card: new code, the old one stops working (documents:create). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { cardError, cardUser } from '@/lib/cards/http'
import { replaceCard } from '@/lib/cards/engine'

export async function POST(request: NextRequest) {
  const u = await cardUser('create')
  if ('error' in u) return u.error
  const p = z.object({ kind: z.enum(['STUDENT', 'STAFF']), id: z.string().min(1), reason: z.string().max(200).nullish(), chargeFee: z.boolean().optional() }).safeParse(await request.json().catch(() => null))
  if (!p.success) return errors.validation(p.error)
  try { return successResponse(await replaceCard(u.user, p.data.kind, p.data.id, { reason: p.data.reason, chargeFee: p.data.chargeFee }), 'New card made — the old one no longer works') } catch (e) { return cardError(e) }
}
