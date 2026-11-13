/** Six phases 1-B: shared answers of the booking APIs. */

import { errorResponse, errors } from '@/lib/api-response'
import { BookingError } from './engine'

export function bookingError(e: unknown) {
  if (e instanceof BookingError) return errorResponse(e.code, e.message, e.status)
  if (e instanceof Error && 'status' in e && typeof (e as { status: unknown }).status === 'number') {
    const x = e as Error & { status: number; code?: string }
    return errorResponse(x.code ?? 'BOOKING_FAILED', x.message, x.status)
  }
  console.error('[BOOKINGS]', e)
  return errors.internal()
}
