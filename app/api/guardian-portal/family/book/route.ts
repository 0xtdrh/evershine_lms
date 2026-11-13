/**
 * GET  /api/guardian-portal/family/book?person=&slug=&code= — six phases 1-B: what this child can book in this course
 *      (starting level, live online groups, branch groups with details, recorded plans; a code may open / start higher).
 * POST /api/guardian-portal/family/book — book it (AUTO: seat held until the first invoice is paid; STAFF: waits for approval).
 */

import { NextRequest } from 'next/server'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { HOUR, rateLimit } from '@/lib/rate-limit-db'
import { familySession } from '@/lib/accounts/portal'
import { bookSchema } from '@/lib/bookings/rules'
import { book, bookingOptions } from '@/lib/bookings/engine'
import { bookingError } from '@/lib/bookings/http'
import { prisma } from '@/lib/prisma'

async function guardianRow(id: string) {
  return prisma.guardian.findUnique({ where: { id }, select: { id: true, userId: true, firstName: true, lastName: true, phoneNumber: true, city: true, partnerId: true } })
}

export async function GET(request: NextRequest) {
  const f = await familySession()
  if (f.error) return f.error
  const sp = request.nextUrl.searchParams
  try {
    return successResponse(await bookingOptions((await guardianRow(f.guardian.id))!, sp.get('person') ?? '', sp.get('slug') ?? '', sp.get('code'), sp.get('group')))
  } catch (e) {
    return bookingError(e)
  }
}

export async function POST(request: NextRequest) {
  const f = await familySession()
  if (f.error) return f.error
  const limited = await rateLimit(`booking:${f.session.user.id}`, 20, HOUR)
  if (!limited.ok) return errors.rateLimited(limited.resetAt)
  const parsed = bookSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try {
    return createdResponse(await book((await guardianRow(f.guardian.id))!, parsed.data))
  } catch (e) {
    return bookingError(e)
  }
}
