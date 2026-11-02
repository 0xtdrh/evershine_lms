/**
 * a02 M3 batch 3, parent. GET ?studentId= — the child's One-to-Ones: coming sessions, postponements left, apologies to answer.
 * POST { groupId, date, newDate, newTime } — move one session (24 h, 2 a month: settings).
 * POST { eventId, choice: 'SUBSTITUTE' | 'POSTPONE', newDate?, newTime? } — answer an instructor's apology.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { oneToOneError } from '@/lib/one-to-one/http'
import { answerApology, assertFamilyEvent, assertFamilyGroup, familySessions, postpone } from '@/lib/one-to-one/sessions'

export const dynamic = 'force-dynamic'

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const TIME = z.string().regex(/^\d{2}:\d{2}$/)
const schema = z.union([
  z.object({ groupId: z.string().min(1), date: DAY, newDate: DAY, newTime: TIME }),
  z.object({ eventId: z.string().min(1), choice: z.enum(['SUBSTITUTE', 'POSTPONE']), newDate: DAY.optional(), newTime: TIME.optional() }),
])

async function parent() {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() }
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return { error: errors.forbidden() }
  return { userId: session.user.id }
}

export async function GET(request: NextRequest) {
  const p = await parent()
  if ('error' in p) return p.error
  const studentId = request.nextUrl.searchParams.get('studentId')
  if (!studentId) return errors.badRequest('Choose the child')
  try { return successResponse(await familySessions(p.userId, studentId)) } catch (e) { return oneToOneError(e) }
}

export async function POST(request: NextRequest) {
  const p = await parent()
  if ('error' in p) return p.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try {
    const d = parsed.data as { eventId?: string; choice?: 'SUBSTITUTE' | 'POSTPONE'; groupId?: string; date?: string; newDate?: string; newTime?: string }
    if (d.eventId) {
      await assertFamilyEvent(p.userId, d.eventId)
      await answerApology(p.userId, d.eventId, { choice: d.choice!, newDate: d.newDate, newTime: d.newTime })
      return successResponse({ done: true })
    }
    await assertFamilyGroup(p.userId, d.groupId!)
    return successResponse(await postpone(p.userId, d.groupId!, { date: d.date!, newDate: d.newDate!, newTime: d.newTime! }))
  } catch (e) { return oneToOneError(e) }
}
