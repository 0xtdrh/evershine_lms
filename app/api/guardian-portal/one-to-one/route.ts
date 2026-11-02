/**
 * a02 M3 batch 2, parent. GET ?studentId= — what can be asked for this child + own requests.
 * GET ?studentId=&levelId=&slots=[…] — how many instructors are free then.
 * POST { studentId, siblingId?, levelId, plan, sessions?, slots, preferredTeacherId?, note? } — ask.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { MODES } from '@/lib/delivery/modes'
import type { SlotInput } from '@/lib/one-to-one/engine'
import { oneToOneError } from '@/lib/one-to-one/http'
import { createRequest, portalCheck, portalOptions, type RequestInput } from '@/lib/one-to-one/requests'
import { PLANS } from '@/lib/one-to-one/rules'
import { withMonthLock } from '@/lib/month-close/with-lock'

export const dynamic = 'force-dynamic'

const schema = z.object({
  studentId: z.string().min(1), siblingId: z.string().min(1).nullish(), levelId: z.string().min(1), plan: z.enum(PLANS), sessions: z.number().int().min(1).max(200).nullish(),
  slots: z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), time: z.string().regex(/^\d{2}:\d{2}$/), mode: z.enum(MODES).optional() })).min(1).max(7),
  preferredTeacherId: z.string().min(1).nullish(), note: z.string().max(300).nullish(),
})

async function parent() {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() }
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return { error: errors.forbidden() }
  return { userId: session.user.id }
}

export async function GET(request: NextRequest) {
  const p = await parent()
  if ('error' in p) return p.error
  const sp = request.nextUrl.searchParams
  const studentId = sp.get('studentId')
  if (!studentId) return errors.badRequest('Choose the child')
  try {
    const levelId = sp.get('levelId')
    if (!levelId) return successResponse(await portalOptions(p.userId, studentId))
    let slots: SlotInput[]
    try { slots = JSON.parse(sp.get('slots') ?? '[]') } catch { return errors.badRequest('Bad times') }
    if (!Array.isArray(slots) || !slots.length) return successResponse({ available: 0, teachers: [] })
    return successResponse(await portalCheck(p.userId, { studentId, levelId, slots }))
  } catch (e) { return oneToOneError(e) }
}

async function POST_(request: NextRequest) {
  const p = await parent()
  if ('error' in p) return p.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { return createdResponse(await createRequest(p.userId, parsed.data as RequestInput)) } catch (e) { return oneToOneError(e) }
}

// a03: it can make invoices ("assign without asking")
export const POST = withMonthLock(POST_)
