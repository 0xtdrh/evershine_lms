/**
 * GET /api/platform/settings — module switches + default language (any signed-in user: the UI hides switched-off
 * modules). PUT { modules?, language? } — platform_settings:update.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { MODULES, getModules, saveModules, getLanguageDefaults, saveLanguageDefaults } from '@/lib/platform/settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const [modules, language] = await Promise.all([getModules(), getLanguageDefaults()])
  return successResponse({ modules, language, catalog: MODULES })
}

const locale = z.enum(['en', 'ar'])
const schema = z.object({
  modules: z.record(z.string(), z.boolean()).optional(),
  language: z.object({ staff: locale, portal: locale }).optional(),
})

export async function PUT(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'platform_settings', 'update')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const modules = parsed.data.modules ? await saveModules(parsed.data.modules, session.user.id) : await getModules()
  if (parsed.data.language) await saveLanguageDefaults(parsed.data.language as { staff: 'en' | 'ar'; portal: 'en' | 'ar' }, session.user.id)
  return successResponse({ modules, language: await getLanguageDefaults() }, 'Saved')
}
