/**
 * GET  /api/admin/wipe-test-data — preview (rows to delete / keep per table)
 * POST /api/admin/wipe-test-data — body { confirm: "امسح كل بيانات التجربة" }
 *
 * Super Admin only (role re-checked in the DB). Takes a backup FIRST; if the
 * backup fails nothing is deleted. See lib/setup/wipe-test-data.ts.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, errorResponse, successResponse } from '@/lib/api-response'
import { logAudit } from '@/lib/audit-logger'
import { requireSuperAdmin } from '@/lib/backup/require-super-admin'
import { runBackup } from '@/lib/backup/run-backup'
import { previewWipe, wipeTestData, WIPE_CONFIRMATION } from '@/lib/setup/wipe-test-data'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET() {
  const { error } = await requireSuperAdmin()
  if (error) return error
  return successResponse({ ...(await previewWipe()), confirmation: WIPE_CONFIRMATION })
}

const bodySchema = z.object({ confirm: z.string() })

export async function POST(request: NextRequest) {
  const { error, userId } = await requireSuperAdmin()
  if (error) return error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = bodySchema.safeParse(body)
  // Tolerate spacing / Unicode-form differences from phone keyboards.
  const norm = (v: string) => v.normalize('NFKC').replace(new RegExp(`[${String.fromCharCode(0x0640)}${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200f)}]`, 'g'), '').replace(/\s+/g, ' ').trim()
  if (!parsed.success || norm(parsed.data.confirm) !== norm(WIPE_CONFIRMATION)) {
    return errors.badRequest(`Type exactly: ${WIPE_CONFIRMATION}`)
  }

  const preview = await previewWipe()
  if (!preview.ready) return errors.conflict(preview.reason ?? 'Not ready')

  // 1. Backup first — no backup, no delete.
  let backupFile: string
  try {
    backupFile = (await runBackup(true)).backup.fileName
  } catch (err) {
    return errorResponse('BACKUP_FAILED', `Backup failed, nothing was deleted: ${err instanceof Error ? err.message : err}`, 500)
  }

  // 2. Wipe (one transaction; rolled back on any broken reference).
  try {
    const result = await wipeTestData(userId!)
    try {
      await logAudit({
        prismaClient: prisma,
        userId: userId!,
        action: 'DELETE',
        entityType: 'TestDataWipe',
        changes: { backupFile, deleted: result.deleted },
        request,
      })
    } catch (auditErr) {
      console.error('[WIPE_AUDIT]', auditErr)
    }
    return successResponse({ backupFile, deleted: result.deleted }, 'Test data deleted')
  } catch (err) {
    console.error('[WIPE_TEST_DATA]', err)
    return errorResponse('WIPE_FAILED', `Nothing was deleted: ${err instanceof Error ? err.message : err}`, 500)
  }
}
