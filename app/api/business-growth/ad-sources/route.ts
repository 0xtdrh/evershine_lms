/**
 * GET /api/business-growth/ad-sources?ym=YYYY-MM — x01: spend, website visits, requests and new students per ad source.
 * PUT { ym, values: { FACEBOOK: 1500, … } } — what was spent per source that month.
 * RBAC business_growth (read / update) and company-wide only (all places): this is company marketing money.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { loadPlaces } from '@/lib/places/server'
import { cairoToday } from '@/lib/dates/cairo'
import { SOURCES } from '@/lib/site/visit-rules'
import { adSourcesFor, saveSpend } from '@/lib/business/ad-sources'

export const dynamic = 'force-dynamic'
const YM = /^\d{4}-(0[1-9]|1[0-2])$/

async function who(action: 'read' | 'update') {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() }
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'business_growth', action)) return { error: errors.forbidden() }
  const places = await loadPlaces({ id: session.user.id, role })
  if (!places.all || role === 'BRANCH_MANAGER') return { error: errors.forbidden('Company-wide only · للشركة كلها بس') }
  return { userId: session.user.id }
}

export async function GET(request: NextRequest) {
  const w = await who('read')
  if (w.error) return w.error
  const ym = request.nextUrl.searchParams.get('ym') || cairoToday().slice(0, 7)
  if (!YM.test(ym)) return errors.badRequest('ym = YYYY-MM')
  try {
    return successResponse(await adSourcesFor(ym))
  } catch (e) {
    console.error('[AD_SOURCES]', e)
    return errors.internal()
  }
}

const Body = z.object({ ym: z.string().regex(YM), values: z.record(z.enum(SOURCES), z.number().min(0).max(100_000_000).nullable()) })

export async function PUT(request: NextRequest) {
  const w = await who('update')
  if (w.error) return w.error
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  await saveSpend(w.userId!, parsed.data.ym, parsed.data.values)
  return successResponse(await adSourcesFor(parsed.data.ym))
}
