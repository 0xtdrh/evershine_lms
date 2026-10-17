/** GET /api/treasury — FIN-1: every account with its balance (+ money not placed yet), for the Money accounts page. */

import { successResponse } from '@/lib/api-response'
import { treasuryUser } from '@/lib/treasury/http'
import { accountsOverview } from '@/lib/treasury/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const u = await treasuryUser('read')
  if ('error' in u) return u.error
  return successResponse(await accountsOverview(u.user))
}
