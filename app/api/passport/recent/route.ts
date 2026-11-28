/** owner 28/11: GET — stamps of the last 7 days for the signed-in parent's children / the student (home-page card). */

import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { recentFamilyStamps } from '@/lib/passport/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  return successResponse(await recentFamilyStamps({ id: session.user.id, role: session.user.role } as never))
}
