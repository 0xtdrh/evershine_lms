/** a02 M3 batch 2, staff: PATCH { action: 'assign', teacherId, teacherRate?, force? } — place a request with this instructor; { action: 'cancel' } — close it. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { oneToOneError, oneToOneUser } from '@/lib/one-to-one/http'
import { staffAssign, staffCancel } from '@/lib/one-to-one/requests'
import { withMonthLock } from '@/lib/month-close/with-lock'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), teacherId: z.string().min(1), teacherRate: z.number().min(0).nullish(), force: z.boolean().optional() }),
  z.object({ action: z.literal('cancel') }),
])

async function PATCH_(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await oneToOneUser('create')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const { id } = await params
  try {
    if (parsed.data.action === 'cancel') { await staffCancel(u.user, id); return successResponse({ cancelled: true }) }
    return successResponse(await staffAssign(u.user, id, parsed.data.teacherId, { force: parsed.data.force, teacherRate: parsed.data.teacherRate }))
  } catch (e) { return oneToOneError(e) }
}

export const PATCH = withMonthLock(PATCH_)
