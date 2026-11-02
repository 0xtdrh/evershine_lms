/** a02 M3 batch 2, parent: DELETE — cancel an own request that is still waiting. */

import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { oneToOneError } from '@/lib/one-to-one/http'
import { cancelByParent } from '@/lib/one-to-one/requests'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return errors.forbidden()
  const { id } = await params
  try { await cancelByParent(session.user.id, id); return successResponse({ cancelled: true }) } catch (e) { return oneToOneError(e) }
}
