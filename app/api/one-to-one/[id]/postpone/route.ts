/** a02 M3 batch 3, staff: POST { date, newDate, newTime, override? } — move one session. override = outside the family's rules (does not use up their postponements). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { assertOneToOne } from '@/lib/one-to-one/engine'
import { oneToOneError, oneToOneUser } from '@/lib/one-to-one/http'
import { postpone } from '@/lib/one-to-one/sessions'

const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), newTime: z.string().regex(/^\d{2}:\d{2}$/), override: z.boolean().optional() })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await oneToOneUser('update')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const { id } = await params
  try {
    await assertOneToOne(u.user, id)
    return successResponse(await postpone(u.user.id, id, parsed.data as { date: string; newDate: string; newTime: string; override?: boolean }))
  } catch (e) { return oneToOneError(e) }
}
