/** GET /api/bookings?status=&q= — six phases 1-B: course bookings from family accounts (family_accounts:read, own places). */

import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { loadPlaces } from '@/lib/places/server'
import { staffSession } from '@/lib/accounts/staff'
import { shape, syncBookings } from '@/lib/bookings/engine'
import { BOOKING_STATUSES } from '@/lib/bookings/rules'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const s = await staffSession('read')
  if (s.error) return s.error
  await syncBookings().catch((e) => console.warn('[BOOKINGS_SYNC]', e))
  const status = request.nextUrl.searchParams.get('status')
  const p = await loadPlaces(s.user)
  const rows = await prisma.courseBooking.findMany({
    where: {
      ...(status && (BOOKING_STATUSES as readonly string[]).includes(status) ? { status } : {}),
      ...(p.all ? {} : { OR: [{ campusId: null }, { campusId: { in: p.campusIds } }] }),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return successResponse(await shape(rows))
}
