/** DELETE /api/guardian-portal/family/bookings/[id] — six phases 1-B: the family cancels a booking (nothing paid yet). */

import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api-response'
import { familySession } from '@/lib/accounts/portal'
import { cancelByFamily } from '@/lib/bookings/engine'
import { bookingError } from '@/lib/bookings/http'

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const f = await familySession()
  if (f.error) return f.error
  try {
    await cancelByFamily(f.guardian.id, (await params).id)
    return successResponse({ ok: true })
  } catch (e) {
    return bookingError(e)
  }
}
