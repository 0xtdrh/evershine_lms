/** a02 M3 batch 3, staff: PATCH { action: 'POSTPONE', newDate, newTime } | { action: 'SUBSTITUTE', teacherId } | { action: 'CLOSE' } on an apology or a released time. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { oneToOneError, oneToOneUser } from '@/lib/one-to-one/http'
import { answerApology, assertStaffEvent, assignSubstitute, closeEvent } from '@/lib/one-to-one/sessions'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('POSTPONE'), newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), newTime: z.string().regex(/^\d{2}:\d{2}$/) }),
  z.object({ action: z.literal('SUBSTITUTE'), teacherId: z.string().min(1) }),
  z.object({ action: z.literal('CLOSE') }),
])

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await oneToOneUser('create')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const { id } = await params
  try {
    await assertStaffEvent(u.user, id)
    if (parsed.data.action === 'SUBSTITUTE') await assignSubstitute(u.user, id, parsed.data.teacherId)
    else if (parsed.data.action === 'POSTPONE') await answerApology(u.user.id, id, { choice: 'POSTPONE', newDate: parsed.data.newDate, newTime: parsed.data.newTime })
    else await closeEvent(u.user, id)
    return successResponse({ done: true })
  } catch (e) { return oneToOneError(e) }
}
