import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors } from '@/lib/api-response'
import { logAudit } from '@/lib/audit-logger'
import { requireSuperAdmin } from '@/lib/backup/require-super-admin'
import { isBackupId, signedDownloadUrl } from '@/lib/backup/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PROXY_MAX_BYTES = 4 * 1024 * 1024

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

  const signedUrl = signedDownloadUrl(id)
  const fileName = id.slice(id.lastIndexOf('/') + 1)

  // Cloudinary's download API names the file "file.gz". Serve it ourselves so it
  // keeps its real name. Vercel caps a function response at 4.5 MB, so bigger
  // files fall back to the Cloudinary redirect.
  try {
    const upstream = await fetch(signedUrl, { cache: 'no-store' })
    const length = Number(upstream.headers.get('content-length') ?? NaN)
    if (upstream.ok && Number.isFinite(length) && length < PROXY_MAX_BYTES) {
      const body = Buffer.from(await upstream.arrayBuffer())
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length': String(body.length),
          'Cache-Control': 'no-store',
        },
      })
    }
    await upstream.body?.cancel()
  } catch (err) {
    console.error('[BACKUP_DOWNLOAD_PROXY]', err)
  }

  const response = NextResponse.redirect(signedUrl, 302)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
