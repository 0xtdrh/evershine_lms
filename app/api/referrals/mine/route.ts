/** GET /api/referrals/mine — phase D: the signed-in parent's referral code, friends who joined, rewards, ambassador badge. */

import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { referralSummaryForGuardianUser } from '@/lib/referrals/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return errors.forbidden()
  const s = await referralSummaryForGuardianUser(session.user.id)
  if (!s) return errors.notFound('Parent')
  return successResponse(s)
}
