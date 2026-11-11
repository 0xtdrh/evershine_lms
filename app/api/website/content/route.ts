/**
 * GET /api/website/content — x01: the website content (saved, merged over the defaults) + the defaults. website:read.
 * PUT /api/website/content { content } | { reset: true } — save it / go back to the defaults. website:update.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { SITE_CONTENT } from '@/lib/site/content'
import { getSiteContent, resetSiteContent, saveSiteContent } from '@/lib/site/content-store'

export const dynamic = 'force-dynamic'

async function who(action: 'read' | 'update') {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() }
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'website', action)) return { error: errors.forbidden() }
  return { userId: session.user.id }
}

export async function GET() {
  const w = await who('read')
  if (w.error) return w.error
  return successResponse({ content: await getSiteContent(), defaults: SITE_CONTENT })
}

export async function PUT(request: NextRequest) {
  const w = await who('update')
  if (w.error) return w.error
  const body = (await request.json().catch(() => null)) as { content?: unknown; reset?: boolean } | null
  if (!body) return errors.badRequest('Invalid body')
  try {
    if (body.reset) return successResponse({ content: await resetSiteContent() })
    if (!body.content || typeof body.content !== 'object') return errors.badRequest('content is required')
    return successResponse({ content: await saveSiteContent(w.userId!, body.content) })
  } catch (e) {
    if (e instanceof Error && e.message === 'TOO_BIG') return errors.badRequest('Too much text · الكلام كتير أوي')
    console.error('[WEBSITE_CONTENT_SAVE]', e)
    return errors.internal()
  }
}
