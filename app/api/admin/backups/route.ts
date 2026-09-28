import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse, createdResponse } from '@/lib/api-response'
import { logAudit } from '@/lib/audit-logger'
import { requireSuperAdmin } from '@/lib/backup/require-super-admin'
import { listBackups, BACKUPS_TO_KEEP } from '@/lib/backup/storage'
import { runBackup } from '@/lib/backup/run-backup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** GET /api/admin/backups — list stored backups (SUPER_ADMIN only). */
export async function GET() {
  const { error } = await requireSuperAdmin()
  if (error) return error

  try {
    const backups = await listBackups()
    return successResponse({ backups, keep: BACKUPS_TO_KEEP })
  } catch (err) {
    console.error('[BACKUPS_LIST]', err)
    return errorResponse('BACKUP_STORAGE_ERROR', 'Could not read backups from storage', 502)
  }
}

/** POST /api/admin/backups — run a backup now (SUPER_ADMIN only). */
export async function POST(request: NextRequest) {
  const { error, userId } = await requireSuperAdmin()
  if (error) return error

  try {
    const result = await runBackup(true)
    try {
      await logAudit({
        prismaClient: prisma,
        userId: userId!,
        action: 'CREATE',
        entityType: 'DatabaseBackup',
        entityId: result.backup.id,
        changes: { tables: result.tables, totalRows: result.totalRows, bytes: result.backup.bytes },
        request,
      })
    } catch (auditError) {
      console.error('[BACKUP_AUDIT]', auditError)
    }
    return createdResponse(result, 'Backup created')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backup failed'
    return errorResponse('BACKUP_FAILED', message, 500)
  }
}
