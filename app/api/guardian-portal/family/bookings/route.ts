/** GET /api/guardian-portal/family/bookings — six phases 1-B: the family's course bookings (newest first). */

import { successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { familySession } from '@/lib/accounts/portal'
import { shape, syncBookings } from '@/lib/bookings/engine'

export async function GET() {
  const f = await familySession()
  if (f.error) return f.error
  await syncBookings({ guardianId: f.guardian.id }).catch((e) => console.warn('[BOOKINGS_SYNC]', e))
  const rows = await prisma.courseBooking.findMany({ where: { guardianId: f.guardian.id }, orderBy: { createdAt: 'desc' }, take: 50 })
  return successResponse((await shape(rows)).map(({ family: _f, campusId: _c, ...x }) => x))
}
