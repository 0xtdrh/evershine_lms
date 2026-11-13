/**
 * GET /api/bookings/[id]/summary — six phases 1-D: one booking for the printable summary (/reports/booking/[id]).
 * The family that made it, or staff with family_accounts:read in its place.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { allowsCampus, loadPlaces } from '@/lib/places/server'
import { bookingView } from '@/lib/bookings/engine'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  const b = await prisma.courseBooking.findUnique({ where: { id }, select: { guardianId: true, campusId: true } })
  if (!b) return errors.notFound('Booking')
  const own = await prisma.guardian.findFirst({ where: { id: b.guardianId, userId: session.user.id }, select: { id: true } })
  if (!own) {
    const role = normalizeRole(session.user.role)
    if (!role || !checkPermission(role, 'family_accounts', 'read')) return errors.notFound('Booking')
    if (b.campusId && !allowsCampus(await loadPlaces(session.user), b.campusId)) return errors.notFound('Booking')
  }
  const v = await bookingView(id)
  const family = await prisma.guardian.findUnique({ where: { id: b.guardianId }, select: { firstName: true, lastName: true, phoneNumber: true } })
  return successResponse({ ...v, family })
}
