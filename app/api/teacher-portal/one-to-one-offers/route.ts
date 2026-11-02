/** a02 M3 batch 2, instructor: GET — One-to-One requests waiting for his answer. */

import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { myOffers } from '@/lib/one-to-one/requests'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (session.user.role !== 'TEACHER') return errors.forbidden()
  return successResponse(await myOffers(session.user.id))
}
