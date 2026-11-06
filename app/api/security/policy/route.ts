/** Security part 2: GET — minutes of no use before this person is signed out (0 = never; families are never signed out this way). */

import { successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { getSecuritySettings } from '@/lib/security/two-factor'
import { PORTAL_ROLES } from '@/lib/security/password-policy'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const s = await getSecuritySettings()
  return successResponse({ idleMinutes: PORTAL_ROLES.includes(session.user.role) ? 0 : s.idleMinutes })
}
