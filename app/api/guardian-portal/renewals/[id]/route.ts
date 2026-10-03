/** POST /api/guardian-portal/renewals/[id] { answer: YES|NO, reason?, note? } — the parent answers (phase A). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { getChildrenForGuardianUser } from '@/lib/academic/guardian'
import { NOT_CONTINUING_REASONS, respondRenewal } from '@/lib/groups/renewal'
import { logSystemContact } from '@/lib/contacts/contact-log'

const bodySchema = z.object({
  answer: z.enum(['YES', 'NO']),
  reason: z.enum(NOT_CONTINUING_REASONS).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return errors.forbidden()
  const { id } = await params
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const req = await prisma.renewalRequest.findUnique({ where: { id }, select: { studentId: true } })
  if (!req) return errors.notFound('Request')
  const mine = (await getChildrenForGuardianUser(session.user.id)).some((c) => c.id === req.studentId)
  if (!mine) return errors.forbidden()

  const r = await respondRenewal({ requestId: id, answer: parsed.data.answer, reason: parsed.data.reason ?? null, note: parsed.data.note ?? null, via: 'PARENT', userId: session.user.id })
  if ('message' in r) return r.status === 409 ? errors.conflict(r.message) : errors.badRequest(r.message)

  const guardian = await prisma.guardian.findUnique({ where: { userId: session.user.id }, select: { id: true } })
  await logSystemContact({
    studentId: req.studentId,
    guardianId: guardian?.id ?? null,
    channel: 'SYSTEM',
    direction: 'IN',
    reason: 'RENEWAL',
    summary: parsed.data.answer === 'YES' ? 'Parent confirmed in the portal: continuing next month.' : `Parent answered in the portal: not continuing (${parsed.data.reason ?? 'OTHER'})${parsed.data.note ? ` — ${parsed.data.note}` : ''}.`,
  })
  return successResponse(r, parsed.data.answer === 'YES' ? 'Thank you! See you next month.' : 'Thank you for letting us know.')
}
