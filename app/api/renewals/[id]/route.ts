/** PATCH /api/renewals/[id] { answer: YES|NO, reason?, note? } — staff record the parent's answer (phase A). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { NOT_CONTINUING_REASONS, respondRenewal } from '@/lib/groups/renewal'
import { logContact } from '@/lib/contacts/contact-log'

const bodySchema = z.object({
  answer: z.enum(['YES', 'NO']),
  reason: z.enum(NOT_CONTINUING_REASONS).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'renewals', 'update')
  if (denied) return denied
  const { id } = await params
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const req = await prisma.renewalRequest.findUnique({ where: { id }, select: { studentId: true, classSectionId: true } })
  if (!req) return errors.notFound('Request')
  const g = await prisma.classSection.findUnique({ where: { id: req.classSectionId }, select: { campusId: true } })
  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && g?.campusId !== campusId) return errors.forbidden()

  const r = await respondRenewal({ requestId: id, answer: parsed.data.answer, reason: parsed.data.reason ?? null, note: parsed.data.note ?? null, via: 'STAFF', userId: session.user.id })
  if ('message' in r) return r.status === 404 ? errors.notFound('Request') : r.status === 409 ? errors.conflict(r.message) : errors.badRequest(r.message)

  try {
    await logContact({
      studentId: req.studentId,
      channel: 'CALL',
      direction: 'IN',
      reason: 'RENEWAL',
      summary: parsed.data.answer === 'YES' ? 'Parent confirmed: continuing next month.' : `Parent said: not continuing (${parsed.data.reason ?? 'OTHER'})${parsed.data.note ? ` — ${parsed.data.note}` : ''}.`,
      userId: session.user.id,
    })
  } catch (err) {
    console.error('[RENEWAL_CONTACT_LOG]', err)
  }
  return successResponse(r)
}
