/** GET /api/cards/history?kind=STUDENT|STAFF&id — 2026-10-19: issued / replaced / printed log of one card holder. */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { cardUser } from '@/lib/cards/http'
import { cardHistory } from '@/lib/cards/engine'

export async function GET(request: NextRequest) {
  const u = await cardUser('read')
  if ('error' in u) return u.error
  const sp = request.nextUrl.searchParams
  const kind = sp.get('kind') === 'STAFF' ? 'STAFF' : 'STUDENT'
  const id = sp.get('id')
  if (!id) return errors.badRequest('id is required')
  return successResponse(await cardHistory(kind, id))
}
