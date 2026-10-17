/** GET /api/treasury/movements?accountId|unplaced=1&from&to — FIN-1: money in / out of an account (or not placed yet). */

import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api-response'
import { treasuryError, treasuryUser } from '@/lib/treasury/http'
import { movements } from '@/lib/treasury/engine'

export const dynamic = 'force-dynamic'
const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const u = await treasuryUser('read')
  if ('error' in u) return u.error
  const sp = request.nextUrl.searchParams
  const d = (k: string) => (DATE.test(sp.get(k) ?? '') ? sp.get(k) : null)
  try { return successResponse(await movements(u.user, { accountId: sp.get('accountId'), unplaced: sp.get('unplaced') === '1', from: d('from'), to: d('to') })) } catch (e) { return treasuryError(e) }
}
