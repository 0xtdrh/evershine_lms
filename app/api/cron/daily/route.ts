/**
 * GET /api/cron/daily — phase C: the daily jobs in one cron (wallet low-balance
 * alerts, birthdays, managers' morning summary). Protected by CRON_SECRET.
 * ?force=1 sends the morning summary again today (testing).
 */

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { runDailyJobs } from '@/lib/jobs/daily'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request, 'daily')) return new NextResponse('Unauthorized', { status: 401 })
  try {
    const r = await runDailyJobs({ forceSummary: new URL(request.url).searchParams.get('force') === '1' })
    return NextResponse.json({ ok: true, ...r })
  } catch (error) {
    console.error('[DAILY_CRON]', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
