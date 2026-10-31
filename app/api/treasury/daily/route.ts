/** GET /api/treasury/daily?date=YYYY-MM-DD&campusId=(&format=xlsx) — a04 daily cash-close sheet of every account the person sees (cash first). */

import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api-response'
import { treasuryError, treasuryUser } from '@/lib/treasury/http'
import { dailySheets } from '@/lib/treasury/daily-sheet'
import { sheetsExcel } from '@/lib/treasury/daily-sheet-excel'
import { cairoToday } from '@/lib/dates/cairo'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const u = await treasuryUser('read')
  if ('error' in u) return u.error
  const sp = request.nextUrl.searchParams
  try {
    const out = await dailySheets(u.user, sp.get('date') || cairoToday(), { campusId: sp.get('campusId') })
    return sp.get('format') === 'xlsx' ? sheetsExcel(out.date, out.sheets) : successResponse(out)
  } catch (e) { return treasuryError(e) }
}
