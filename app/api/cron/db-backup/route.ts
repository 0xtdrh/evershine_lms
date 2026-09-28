/**
 * GET /api/cron/db-backup
 *
 * Daily database backup via Vercel Cron (`0 1 * * *` UTC = 4 AM Egypt in summer
 * time, 3 AM after DST ends). On the Hobby plan Vercel may fire it any time
 * within that hour.
 *
 * SECURITY: Protected by CRON_SECRET authorization header.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runBackup } from '@/lib/backup/run-backup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const result = await runBackup(false)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Backup failed' },
      { status: 500 }
    )
  }
}
