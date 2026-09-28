import { prisma } from '@/lib/prisma'
import { createSqlDump } from './db-dump'
import { backupFileName, pruneBackups, uploadBackup, type StoredBackup } from './storage'

export interface BackupRunResult {
  backup: StoredBackup
  tables: number
  totalRows: number
  rawBytes: number
  durationMs: number
  deleted: string[]
}

// Vercel Hobby functions stop at 60s; leave room for upload + prune.
const DUMP_DEADLINE_MS = 40_000

/**
 * Dump -> upload -> keep newest 7. Old backups are only pruned after the new
 * one is safely uploaded. On failure every SUPER_ADMIN gets a notification.
 */
export async function runBackup(manual: boolean): Promise<BackupRunResult> {
  try {
    const dump = await createSqlDump({ deadlineMs: DUMP_DEADLINE_MS })
    const backup = await uploadBackup(dump.gz, backupFileName(dump.createdAt, manual))
    const deleted = await pruneBackups()
    return {
      backup,
      tables: dump.tables.length,
      totalRows: dump.tables.reduce((sum, t) => sum + t.rows, 0),
      rawBytes: dump.rawBytes,
      durationMs: dump.durationMs,
      deleted,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[DB_BACKUP_FAILED]', message)
    try {
      const admins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true } })
      if (admins.length) {
        await prisma.notification.createMany({
          data: admins.map((a) => ({
            userId: a.id,
            title: 'Database backup FAILED',
            message: `${manual ? 'Manual' : 'Daily'} backup failed: ${message.slice(0, 300)}`,
            type: 'BACKUP_FAILED',
          })),
        })
      }
    } catch (notifyError) {
      console.error('[DB_BACKUP_NOTIFY_FAILED]', notifyError)
    }
    throw error
  }
}
