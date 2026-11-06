/** Security part 2: two-step sign-in on / off, which roles must use it, idle sign-out minutes. Super Admin only. */

import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { getSecuritySettings, saveSecuritySettings } from '@/lib/security/two-factor'
import { TWO_FACTOR_ROLE_CHOICES } from '@/lib/security/totp'

export const dynamic = 'force-dynamic'

const schema = z.object({
  twoFactorEnabled: z.boolean().optional(),
  twoFactorRoles: z.array(z.enum(TWO_FACTOR_ROLE_CHOICES as [string, ...string[]])).max(10).optional(),
  idleMinutes: z.number().int().min(0).max(720).optional(),
})

async function superAdmin() {
  const { session, error } = await requireSession()
  if (error || !session) return { error: error! }
  if (session.user.role !== 'SUPER_ADMIN') return { error: errors.forbidden() }
  return { userId: session.user.id }
}

export async function GET() {
  const u = await superAdmin()
  if ('error' in u) return u.error
  return successResponse({ ...(await getSecuritySettings()), roleChoices: TWO_FACTOR_ROLE_CHOICES })
}

export async function PUT(request: Request) {
  const u = await superAdmin()
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveSecuritySettings(parsed.data, u.userId))
}
