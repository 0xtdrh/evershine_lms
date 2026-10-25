/**
 * Rules of the public online application (2026-10-24).
 * GET — public (the application form has no login). PUT { items: [{ en, ar }] } — agreements:update.
 */

import type { Role } from '@prisma/client'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { ADMISSION_RULES_KEY, DEFAULT_ADMISSION_RULES, MAX_ADMISSION_RULES, cleanAdmissionRules, type AdmissionRule, type AdmissionRules } from '@/lib/admissions/rules'

export async function GET() {
  const v = await getSetting<AdmissionRules>(ADMISSION_RULES_KEY, DEFAULT_ADMISSION_RULES)
  return successResponse(Array.isArray(v?.items) ? v : DEFAULT_ADMISSION_RULES)
}

const schema = z.object({
  items: z.array(z.object({ en: z.string().max(600), ar: z.string().max(600) })).max(MAX_ADMISSION_RULES),
})

export async function PUT(req: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'agreements', 'update')
  if (denied) return denied
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const value = cleanAdmissionRules(parsed.data.items as AdmissionRule[])
  if (!value.items.length) return errors.badRequest('Write at least one rule · اكتب شرط واحد على الأقل')
  await setSetting(ADMISSION_RULES_KEY, value, session.user.id)
  return successResponse(value)
}
