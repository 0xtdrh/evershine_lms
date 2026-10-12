/** P2: profile settings — GET (staff who read passports), PUT (passport:approve). */

import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { profileSettingsSchema, type ProfileSettings } from '@/lib/profile/rules'
import { getProfileSettings, saveProfileSettings } from '@/lib/profile/engine'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role as Role, 'passport', 'read')) return errors.forbidden()
  return successResponse(await getProfileSettings())
}

export async function PUT(req: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role as Role, 'passport', 'approve')) return errors.forbidden()
  const parsed = profileSettingsSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  await saveProfileSettings(parsed.data as ProfileSettings, session.user.id)
  return successResponse(parsed.data)
}
