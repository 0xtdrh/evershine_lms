/** GET /api/treasury/daily/[accountId]?date=YYYY-MM-DD(&format=xlsx) — a04 one account's daily cash-close sheet (every movement of the day). */

import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api-response'
import { treasuryError, treasuryUser } from '@/lib/treasury/http'
import { dailySheet } from '@/lib/treasury/daily-sheet'
import { sheetExcel } from '@/lib/treasury/daily-sheet-excel'
import { cairoToday } from '@/lib/dates/cairo'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ accountId: string }> }) {
  const u = await treasuryUser('read')
  if ('error' in u) return u.error
  const { accountId } = await params
  const sp = request.nextUrl.searchParams
  try {
    const sheet = await dailySheet(u.user, accountId, sp.get('date') || cairoToday())
    return sp.get('format') === 'xlsx' ? sheetExcel(sheet) : successResponse(sheet)
  } catch (e) { return treasuryError(e) }
}
