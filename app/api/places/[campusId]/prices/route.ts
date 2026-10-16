/**
 * Partners part 1: special prices of a place (branch or partner place) per level.
 * GET — every level with its normal price and this place's price; PUT { items } — save (null = back to the level price).
 * Partner places need `partners`, branches need `campuses` (read / update); the place must be one of the person's places.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { allowsCampus, loadPlaces } from '@/lib/places/server'
import { placePricesSchema } from '@/lib/partners/validation'

type P = { params: Promise<{ campusId: string }> }

async function guard(user: { id: string; role: string }, campusId: string, action: 'read' | 'update') {
  const c = await prisma.campus.findUnique({ where: { id: campusId }, select: { kind: true } })
  if (!c) return errors.notFound('Place')
  if (!checkPermission(user.role as Role, c.kind === 'PARTNER' ? 'partners' : 'campuses', action)) return errors.forbidden()
  if (!allowsCampus(await loadPlaces(user), campusId)) return errors.forbidden()
  return null
}

export async function GET(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { campusId } = await params
  const denied = await guard(session.user, campusId, 'read')
  if (denied) return denied
  const [levels, prices] = await Promise.all([
    prisma.level.findMany({
      orderBy: [{ subject: { name: 'asc' } }, { order: 'asc' }],
      select: { id: true, name: true, pricingType: true, monthlyPrice: true, fullLevelPrice: true, subject: { select: { name: true, track: { select: { name: true } } } } },
    }),
    prisma.placePrice.findMany({ where: { campusId } }),
  ])
  const P = new Map(prices.map((p) => [p.levelId, p]))
  return successResponse(levels.map((l) => ({
    levelId: l.id, level: l.name, course: l.subject?.name ?? '', track: l.subject?.track?.name ?? '', pricingType: l.pricingType,
    normal: { monthlyPrice: l.monthlyPrice === null ? null : Number(l.monthlyPrice), fullLevelPrice: l.fullLevelPrice === null ? null : Number(l.fullLevelPrice) },
    place: P.has(l.id) ? { monthlyPrice: P.get(l.id)!.monthlyPrice === null ? null : Number(P.get(l.id)!.monthlyPrice), fullLevelPrice: P.get(l.id)!.fullLevelPrice === null ? null : Number(P.get(l.id)!.fullLevelPrice) } : null,
  })))
}

export async function PUT(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { campusId } = await params
  const denied = await guard(session.user, campusId, 'update')
  if (denied) return denied
  const parsed = placePricesSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  for (const i of parsed.data.items) {
    const monthlyPrice = i.monthlyPrice ?? null
    const fullLevelPrice = i.fullLevelPrice ?? null
    if (monthlyPrice === null && fullLevelPrice === null) {
      await prisma.placePrice.deleteMany({ where: { campusId, levelId: i.levelId! } })
      continue
    }
    await prisma.placePrice.upsert({
      where: { campusId_levelId: { campusId, levelId: i.levelId! } },
      create: { campusId, levelId: i.levelId!, monthlyPrice, fullLevelPrice, updatedById: session.user.id },
      update: { monthlyPrice, fullLevelPrice, updatedById: session.user.id },
    })
  }
  try {
    await prisma.auditLog.create({ data: { userId: session.user.id, action: 'UPDATE', entityType: 'PlacePrice', entityId: campusId, changes: { items: parsed.data.items } } })
  } catch (err) {
    console.error('[PLACE_PRICE_AUDIT]', err)
  }
  return successResponse({ saved: parsed.data.items.length }, 'Prices saved — they apply to new invoices')
}
