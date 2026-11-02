/** a02 M3 batch 3: close moving students between groups (everywhere / a system / a place / a partner). GET (one_to_one:read) / PUT (one_to_one:update, every place). */

import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { oneToOneUser } from '@/lib/one-to-one/http'
import { getTransferLocks, saveTransferLocks } from '@/lib/groups/transfer-lock'
import { loadPlaces } from '@/lib/places/server'

export const dynamic = 'force-dynamic'

const schema = z.object({
  all: z.boolean(), kinds: z.array(z.enum(['ONE_TO_ONE', 'GROUP'])).max(2), modes: z.array(z.enum(['ONLINE', 'BRANCH'])).max(2),
  campusIds: z.array(z.string().min(1)).max(200), partnerIds: z.array(z.string().min(1)).max(200),
})

export async function GET() {
  const u = await oneToOneUser('read')
  if ('error' in u) return u.error
  return successResponse(await getTransferLocks())
}

export async function PUT(request: Request) {
  const u = await oneToOneUser('update')
  if ('error' in u) return u.error
  if (!(await loadPlaces(u.user as never)).all) return errors.forbidden('Company settings need every place')
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveTransferLocks(parsed.data, u.user.id))
}
