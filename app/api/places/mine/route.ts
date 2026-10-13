/**
 * M0: the header place filter. GET — the places this person may see + the chosen one; POST { campusId | 'ALL' } —
 * choose (cookie `tn_place`; it can only narrow what the person may see).
 */

import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { allowsCampus, loadPlaces, PLACE_COOKIE } from '@/lib/places/server'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const p = await loadPlaces({ id: session.user.id, role: session.user.role })
  const campuses = await prisma.campus.findMany({ where: { isActive: true, ...(p.all ? {} : { id: { in: p.campusIds } }) }, select: { id: true, name: true, kind: true }, orderBy: { name: 'asc' } })
  const chosen = (await cookies()).get(PLACE_COOKIE)?.value ?? 'ALL'
  return successResponse({ all: p.all, places: campuses, singleGroups: p.groupIds.length, selected: chosen !== 'ALL' && allowsCampus(p, chosen) ? chosen : 'ALL' })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const body = (await req.json().catch(() => null)) as { campusId?: string } | null
  const want = body?.campusId || 'ALL'
  const p = await loadPlaces({ id: session.user.id, role: session.user.role })
  if (want !== 'ALL' && !allowsCampus(p, want)) return errors.forbidden('You cannot see this place')
  ;(await cookies()).set(PLACE_COOKIE, want, { path: '/', sameSite: 'lax', httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 180 })
  return successResponse({ selected: want })
}
