import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors } from '@/lib/api-response'
import { logAudit } from '@/lib/audit-logger'
import { requireSuperAdmin } from '@/lib/backup/require-super-admin'
import { isBackupId, signedDownloadUrl } from '@/lib/backup/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/admin/backups/download?id=technova-backups/...
 *
 * SUPER_ADMIN only. Redirects to a Cloudinary signed link that expires in
 * 2 minutes. Every download is written to the audit log.
 */
export async function GET(request: NextRequest) {
  const { error, userId } = await requireSuperAdmin()
  if (error) return error

  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!isBackupId(id)) return errors.badRequest('Invalid backup id')

  try {
    await logAudit({
      prismaClient: prisma,
      userId: userId!,
      action: 'DOWNLOAD',
      entityType: 'DatabaseBackup',
      entityId: id,
      request,
    })
  } catch (auditError) {
    console.error('[BACKUP_DOWNLOAD_AUDIT]', auditError)
  }

  const response = NextResponse.redirect(signedDownloadUrl(id), 302)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
