/** a02 M3 batch 3, parent: POST { groupId, note } — ask for another time or instructor; the staff do it. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { oneToOneError } from '@/lib/one-to-one/http'
import { askChange, assertFamilyGroup } from '@/lib/one-to-one/sessions'

const schema = z.object({ groupId: z.string().min(1), note: z.string().trim().min(2).max(300) })

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return errors.forbidden()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try {
    await assertFamilyGroup(session.user.id, parsed.data.groupId!)
    await askChange(session.user.id, parsed.data.groupId!, parsed.data.note!)
    return successResponse({ done: true })
  } catch (e) { return oneToOneError(e) }
}
