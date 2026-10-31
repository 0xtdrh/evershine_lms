/** GET /api/treasury/daily/[accountId]?date=YYYY-MM-DD — a04 one account's daily cash-close sheet (every movement of the day). */

import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api-response'
import { treasuryError, treasuryUser } from '@/lib/treasury/http'
import { dailySheet } from '@/lib/treasury/daily-sheet'
import { cairoToday } from '@/lib/dates/cairo'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ accountId: string }> }) {
  const u = await treasuryUser('read')
  if ('error' in u) return u.error
  const { accountId } = await params
  try { return successResponse(await dailySheet(u.user, accountId, request.nextUrl.searchParams.get('date') || cairoToday())) } catch (e) { return treasuryError(e) }
}
