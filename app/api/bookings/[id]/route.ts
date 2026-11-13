/** POST /api/bookings/[id] { action: APPROVE | REJECT | CANCEL, reason } — six phases 1-B: staff decide a booking (family_accounts:update). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { staffSession } from '@/lib/accounts/staff'
import { decide } from '@/lib/bookings/engine'
import { bookingError } from '@/lib/bookings/http'

const schema = z.object({ action: z.enum(['APPROVE', 'REJECT', 'CANCEL']), reason: z.string().trim().max(300).nullable().optional() })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await staffSession('update')
  if (s.error) return s.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try {
    return successResponse(await decide(s.user, (await params).id, parsed.data.action, parsed.data.reason))
  } catch (e) {
    return bookingError(e)
  }
}
