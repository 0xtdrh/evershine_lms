/** a02 M3: remove one row of the One-to-One price list (a One-to-One already booked keeps its price). */

import { successResponse } from '@/lib/api-response'
import { removePrice } from '@/lib/one-to-one/engine'
import { oneToOneError, oneToOneUser } from '@/lib/one-to-one/http'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await oneToOneUser('update')
  if ('error' in u) return u.error
  const { id } = await params
  try { await removePrice(u.user, id); return successResponse({ removed: true }) } catch (e) { return oneToOneError(e) }
}
