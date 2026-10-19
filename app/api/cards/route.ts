/**
 * GET /api/cards?kind=STUDENT&groupId|campusId|ids=a,b — 2026-10-19 student ID cards to print (makes the first code).
 * GET /api/cards?kind=STAFF&campusId|ids=a,b — staff cards. documents:read, places-limited.
 */

import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api-response'
import { cardError, cardUser } from '@/lib/cards/http'
import { staffCards, studentCards } from '@/lib/cards/engine'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const u = await cardUser('read')
  if ('error' in u) return u.error
  const sp = request.nextUrl.searchParams
  const ids = (sp.get('ids') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  try {
    if (sp.get('kind') === 'STAFF') return successResponse(await staffCards(u.user, { campusId: sp.get('campusId'), userIds: ids }))
    return successResponse(await studentCards(u.user, { groupId: sp.get('groupId'), campusId: sp.get('campusId'), studentIds: ids }))
  } catch (e) { return cardError(e) }
}
