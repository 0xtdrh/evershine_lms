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
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { runBackup } from '@/lib/backup/run-backup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request, 'db-backup')) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const result = await runBackup(false)
    console.log('[DB_BACKUP_CRON] ok', { file: result.backup.fileName, tables: result.tables, rows: result.totalRows, ms: result.durationMs })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[DB_BACKUP_CRON] failed', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Backup failed' },
      { status: 500 }
    )
  }
}
