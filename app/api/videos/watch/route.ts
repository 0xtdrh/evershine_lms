/** a02 M4 batch 3: GET — students whose video watching looks unusual in the last 7 days. */

import { successResponse } from '@/lib/api-response'
import { suspiciousViewers } from '@/lib/videos/engine'
import { videoAdmin } from '@/lib/videos/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  const u = await videoAdmin('read')
  if ('error' in u) return u.error
  return successResponse(await suspiciousViewers())
}
