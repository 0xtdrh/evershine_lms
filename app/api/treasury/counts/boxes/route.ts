/** GET /api/treasury/counts/boxes — J01: the cash boxes the person may count (balance only when they see balances). */

import { successResponse } from '@/lib/api-response'
import { treasuryUser } from '@/lib/treasury/http'
import { countBoxes } from '@/lib/treasury/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const u = await treasuryUser('read', { countOnly: true })
  if ('error' in u) return u.error
  return successResponse(await countBoxes(u.user))
}
