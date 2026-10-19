/** POST /api/cards/printed { cards: [{ kind, id, code }] } — 2026-10-19: who printed which cards (documents:read). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { cardUser } from '@/lib/cards/http'
import { logPrinted } from '@/lib/cards/engine'

export async function POST(request: NextRequest) {
  const u = await cardUser('read')
  if ('error' in u) return u.error
  const p = z.object({ cards: z.array(z.object({ kind: z.enum(['STUDENT', 'STAFF']), id: z.string().min(1), code: z.string().min(1).max(80) })).max(500) }).safeParse(await request.json().catch(() => null))
  if (!p.success) return errors.validation(p.error)
  return successResponse(await logPrinted(u.user, p.data.cards as { kind: 'STUDENT' | 'STAFF'; id: string; code: string }[]))
}
