/**
 * GET /api/website/courses — tracks and courses with how each is listed on the website's courses page, + the company
 * defaults for the page's sections (website:read).
 * PUT { listing } saves one listing · PUT { settings: { sections } } saves the company defaults (website:update).
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { listingSchema } from '@/lib/site/courses'
import { adminCatalog, getCoursesSettings, saveCoursesSettings, saveListing, slugUsed } from '@/lib/site/courses-store'

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
  const [items, settings] = await Promise.all([adminCatalog(), getCoursesSettings()])
  return successResponse({ items, settings })
}

export async function PUT(request: NextRequest) {
  const w = await who('update')
  if (w.error) return w.error
  const body = (await request.json().catch(() => null)) as { listing?: unknown; settings?: { sections?: Record<string, boolean> } } | null
  if (!body) return errors.badRequest('Invalid body')
  if (body.settings) {
    await saveCoursesSettings(w.userId!, body.settings.sections ?? {})
    return successResponse({ settings: await getCoursesSettings() })
  }
  const parsed = listingSchema.safeParse(body.listing)
  if (!parsed.success) return errors.validation(parsed.error)
  if (await slugUsed(parsed.data.slug, { refType: String(parsed.data.refType), refId: String(parsed.data.refId) })) return errors.badRequest('This link name is used by another course · اسم اللينك ده مستخدم لكورس تاني')
  return successResponse({ listing: await saveListing(w.userId!, parsed.data) })
}
