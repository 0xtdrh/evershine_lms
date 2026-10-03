/** POST /api/guardian-portal/wallet/withdrawals { studentId, amount, payoutMethod, reason? } — the parent asks for money back (phase B). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { errors, createdResponse } from '@/lib/api-response'
import { getChildrenForGuardianUser } from '@/lib/academic/guardian'
import { isActivePaymentMethod } from '@/lib/fees/payment-settings'
import { requestWithdrawal } from '@/lib/wallet/engine'

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return errors.forbidden()
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = z.object({ studentId: z.string().min(1), amount: z.number().positive(), payoutMethod: z.string().min(1).max(50), reason: z.string().trim().max(500).optional().nullable() }).safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const mine = (await getChildrenForGuardianUser(session.user.id)).some((c) => c.id === parsed.data.studentId)
  if (!mine) return errors.forbidden()
  if (!(await isActivePaymentMethod(parsed.data.payoutMethod!))) return errors.badRequest('Choose how you want the money back')
  const r = await requestWithdrawal({ studentId: parsed.data.studentId!, amount: parsed.data.amount!, payoutMethod: parsed.data.payoutMethod!, reason: parsed.data.reason ?? null, via: 'PARENT', userId: session.user.id })
  if ('message' in r) return r.status === 403 ? errors.forbidden(r.message) : errors.badRequest(r.message)
  return createdResponse(r, 'Request sent. You will be notified when it is approved.')
}
