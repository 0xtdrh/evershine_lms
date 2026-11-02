/** a02 M3 batch 3, staff: GET ?campusId= — instructor apologies and released times waiting for someone. */

import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api-response'
import { oneToOneUser } from '@/lib/one-to-one/http'
import { staffEvents } from '@/lib/one-to-one/sessions'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const u = await oneToOneUser('read')
  if ('error' in u) return u.error
  return successResponse(await staffEvents(u.user, { campusId: request.nextUrl.searchParams.get('campusId') }))
}
