/**
 * PUT /api/business-growth/targets { ym, campusId?, values: { income?, newStudents?, activeStudents?, continuation?, attendance?, collection? } }
 * p14: monthly targets. RBAC business_growth:update. Company targets ("ALL") need every place; a place target needs that place.
 * A value of 0 / null removes the target.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { loadPlaces } from '@/lib/places/server'
import { saveTargets } from '@/lib/business/engine'
import { TARGET_METRICS } from '@/lib/business/calc'

export const dynamic = 'force-dynamic'

const metric = z.number().min(0).max(100_000_000).nullable().optional()
const Body = z.object({
  ym: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  campusId: z.string().min(1).nullable().optional(),
  values: z.object(Object.fromEntries(TARGET_METRICS.map((m) => [m.key, metric])) as Record<(typeof TARGET_METRICS)[number]['key'], typeof metric>).strict(),
})

export async function PUT(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'business_growth', 'update')) return errors.forbidden()
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.badRequest(parsed.error.issues[0]?.message ?? 'Invalid targets')
  const { ym, campusId, values } = parsed.data
  for (const k of ['continuation', 'attendance', 'collection'] as const) if ((values[k] ?? 0) > 100) return errors.badRequest('A % target must be 0–100 · النسبة لازم تبقى من 0 لـ 100')
  const places = await loadPlaces({ id: session.user.id, role })
  if (campusId ? !(places.all || places.campusIds.includes(campusId)) : !places.all) return errors.forbidden('Not your place · المكان ده مش بتاعك')
  await saveTargets(session.user.id, ym, campusId ?? 'ALL', values)
  return successResponse({ saved: true })
}
