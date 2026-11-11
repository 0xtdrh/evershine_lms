/** GET /api/website/visitors?days=30 — x01: website visitors (counts only, never IPs). RBAC website:read. */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { siteAnalytics } from '@/lib/site/analytics'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'website', 'read')) return errors.forbidden()
  const days = Math.min(365, Math.max(1, Number(request.nextUrl.searchParams.get('days')) || 30))
  try {
    return successResponse(await siteAnalytics(days))
  } catch (e) {
    console.error('[WEBSITE_VISITORS]', e)
    return errors.internal()
  }
}
