/**
 * GET  /api/bookings/[id] — six phases 1-C: for a booking waiting for its level, the course's levels and the fitting groups.
 * POST /api/bookings/[id] { action: APPROVE | REJECT | CANCEL | PLACE, reason, levelId, groupId, plan } — staff decide a booking
 *      (family_accounts:update, their places). PLACE sets the level (and group) of a track booking, then places the child.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { allowsCampus, loadPlaces } from '@/lib/places/server'
import { staffSession } from '@/lib/accounts/staff'
import { decide, placementOptions } from '@/lib/bookings/engine'
import { bookingError } from '@/lib/bookings/http'

const schema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'CANCEL', 'PLACE']),
  reason: z.string().trim().max(300).nullable().optional(),
  levelId: z.string().max(40).nullable().optional(),
  groupId: z.string().max(40).nullable().optional(),
  plan: z.enum(['ONE_TIME', 'SUBSCRIPTION']).nullable().optional(),
})

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await staffSession('read')
  if (s.error) return s.error
  const { id } = await params
  const b = await prisma.courseBooking.findUnique({ where: { id }, select: { campusId: true } })
  if (!b || (b.campusId && !allowsCampus(await loadPlaces(s.user), b.campusId))) return errors.notFound('Booking')
  try {
    return successResponse(await placementOptions(id))
  } catch (e) {
    return bookingError(e)
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await staffSession('update')
  if (s.error) return s.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const v = parsed.data
  try {
    return successResponse(await decide(s.user, (await params).id, v.action, v.reason, { levelId: v.levelId, groupId: v.groupId, plan: v.plan }))
  } catch (e) {
    return bookingError(e)
  }
}
