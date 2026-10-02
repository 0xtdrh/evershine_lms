/**
 * GET /api/staff-applications/[id]/cv
 * Opens the CV of a job application: checks the permission, then redirects to
 * a 2-minute signed link (CVs are private files, see lib/staff-cv-storage.ts).
 */

import { NextRequest, NextResponse } from 'next/server'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors } from '@/lib/api-response'
import { privateCvDownloadUrl } from '@/lib/staff-cv-storage'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'staff_applications', 'read')) return errors.forbidden()

  const { id } = await params
  const app = await prisma.staffApplicationRequest.findUnique({ where: { id }, select: { cvDocUrl: true, cvLink: true } })
  if (!app) return errors.notFound('Application')

  const url = privateCvDownloadUrl(app.cvDocUrl)
  if (url) {
    const res = NextResponse.redirect(url)
    res.headers.set('Cache-Control', 'no-store')
    return res
  }
  if (app.cvLink && /^https?:\/\//.test(app.cvLink)) return NextResponse.redirect(app.cvLink)
  return errors.notFound('CV')
}
