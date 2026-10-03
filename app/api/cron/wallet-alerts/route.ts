/**
 * GET /api/cron/wallet-alerts — daily: tell parents whose wallet is below next
 * month's price (phase B). Protected by CRON_SECRET like the other cron routes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { lowBalanceAlerts } from '@/lib/wallet/engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request, 'wallet-alerts')) return new NextResponse('Unauthorized', { status: 401 })
  try {
    const r = await lowBalanceAlerts()
    return NextResponse.json({ ok: true, ...r })
  } catch (error) {
    console.error('[WALLET_ALERTS_CRON]', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
