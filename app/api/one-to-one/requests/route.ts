/** a02 M3 batch 2, staff: GET ?campusId=&all=1 — parents' One-to-One requests in the person's places (waiting ones unless all=1). */

import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api-response'
import { oneToOneUser } from '@/lib/one-to-one/http'
import { staffRequests } from '@/lib/one-to-one/requests'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const u = await oneToOneUser('read')
  if ('error' in u) return u.error
  const sp = request.nextUrl.searchParams
  return successResponse(await staffRequests(u.user, { campusId: sp.get('campusId'), all: sp.get('all') === '1' }))
}
