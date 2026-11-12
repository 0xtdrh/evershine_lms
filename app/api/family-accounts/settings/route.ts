/** GET / PUT /api/family-accounts/settings — six phases 1-A: sign-up open, unsuitable courses (lock / hide), e-mail check, link days. */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { accountsSettingsSchema } from '@/lib/accounts/rules'
import { getAccountsSettings, saveAccountsSettings } from '@/lib/accounts/engine'
import { staffSession } from '@/lib/accounts/staff'

export async function GET() {
  const s = await staffSession('read')
  if (s.error) return s.error
  return successResponse({ settings: await getAccountsSettings(), emailReady: !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) })
}

export async function PUT(request: NextRequest) {
  const s = await staffSession('update')
  if (s.error) return s.error
  if (!['SUPER_ADMIN', 'ADMIN'].includes(s.user.role)) return errors.forbidden()
  const parsed = accountsSettingsSchema.partial().safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse({ settings: await saveAccountsSettings(s.user.id, parsed.data) })
}
