/** PATCH /api/payment-voids/[id] { action: 'approve' | 'reject', note? } — approve: payment_voids:approve, never your own request; reject: an approver, or the person who asked (withdraw). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errorResponse, errors, successResponse } from '@/lib/api-response'
import { canSeeInvoice } from '@/lib/places/server'
import { approveVoid, rejectVoid } from '@/lib/payments/void'
import { withMonthLock } from '@/lib/month-close/with-lock'

export const dynamic = 'force-dynamic'
const body = z.object({ action: z.enum(['approve', 'reject']), note: z.string().trim().max(500).optional().nullable() })

async function PATCH_(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const v = await prisma.paymentVoid.findUnique({ where: { id }, select: { invoiceId: true } })
  if (!v) return errors.notFound('Request')
  if (!(await canSeeInvoice(session.user, v.invoiceId))) return errors.forbidden()
  const who = { id: session.user.id, role: session.user.role }
  const r = parsed.data.action === 'approve' ? await approveVoid(id, who, parsed.data.note) : await rejectVoid(id, who, parsed.data.note)
  if (r.ok === false) return errorResponse(r.code ?? 'VOID_REFUSED', r.message, r.status)
  return successResponse(r)
}
export const PATCH = withMonthLock(PATCH_)
