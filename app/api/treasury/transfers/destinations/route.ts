/** GET /api/treasury/transfers/destinations — accounts this person may send money to (own + company ones when allowed). */

import { successResponse } from '@/lib/api-response'
import { treasuryError, treasuryUser } from '@/lib/treasury/http'
import { transferDestinations } from '@/lib/treasury/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const u = await treasuryUser('create')
  if ('error' in u) return u.error
  try { return successResponse(await transferDestinations(u.user)) } catch (e) { return treasuryError(e) }
}
