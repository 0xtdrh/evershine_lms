/** POST /api/guardian-portal/wallet/transfer { fromId, toId, amount } — a parent moves money between their children (phase B). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { getChildrenForGuardianUser } from '@/lib/academic/guardian'
import { transferBetweenSiblings } from '@/lib/wallet/engine'

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return errors.forbidden()
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ fromId: z.string().min(1), toId: z.string().min(1), amount: z.number().positive() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const mine = new Set((await getChildrenForGuardianUser(session.user.id)).map((c) => c.id))
  if (!mine.has(parsed.data.fromId!) || !mine.has(parsed.data.toId!)) return errors.forbidden()
  const r = await transferBetweenSiblings({ fromId: parsed.data.fromId!, toId: parsed.data.toId!, amount: parsed.data.amount!, userId: session.user.id })
  if ('message' in r) return errors.badRequest(r.message)
  return successResponse(r, 'Moved')
}
