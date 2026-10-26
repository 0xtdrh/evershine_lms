/** GET /api/month-close/pending?ym=YYYY-MM&campusId= — a03: things of that month still waiting (checklist before closing). */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { allowsCampus, loadPlaces } from '@/lib/places/server'
import { pendingFor } from '@/lib/month-close/engine'
import { monthCloseUser, scopeParam } from '@/lib/month-close/http'
import { PENDING_LABELS, pendingTotal, type PendingKey } from '@/lib/month-close/rules'

export async function GET(request: NextRequest) {
  const u = await monthCloseUser('read')
  if ('error' in u) return u.error
  const sp = request.nextUrl.searchParams
  const ym = sp.get('ym') ?? ''
  if (!/^\d{4}-\d{2}$/.test(ym)) return errors.badRequest('ym must be YYYY-MM')
  const campusId = scopeParam(sp.get('campusId'))
  const p = await loadPlaces(u.user)
  if (campusId ? !allowsCampus(p, campusId) : !p.all) return errors.forbidden()
  const pending = await pendingFor(ym, campusId)
  return successResponse({
    total: pendingTotal(pending),
    items: Object.entries(pending).map(([key, count]) => ({ key, count, ...PENDING_LABELS[key as PendingKey] })),
  })
}
