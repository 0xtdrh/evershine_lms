/** GET /api/month-close/history?ym=YYYY-MM — a03: who closed / reopened that month, when and why (scopes this person sees). */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { monthHistory } from '@/lib/month-close/engine'
import { monthCloseUser } from '@/lib/month-close/http'
import { allowsCampus, loadPlaces } from '@/lib/places/server'

export async function GET(request: NextRequest) {
  const u = await monthCloseUser('read')
  if ('error' in u) return u.error
  const ym = request.nextUrl.searchParams.get('ym') ?? ''
  if (!/^\d{4}-\d{2}$/.test(ym)) return errors.badRequest('ym must be YYYY-MM')
  const p = await loadPlaces(u.user)
  const rows = (await monthHistory(ym)).filter((e) => (e.scopeKey === 'ALL' ? p.all : allowsCampus(p, e.scopeKey)))
  return successResponse(rows)
}
