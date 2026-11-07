/**
 * Cancel a payment recorded by mistake (lib/payments/void.ts).
 * GET  /api/payment-voids?status=PENDING|ALL — requests of the person's places (payment_voids:read)
 * POST /api/payment-voids { paymentId, reason } — ask to cancel (payment_voids:create); another person approves
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { createdResponse, errorResponse, errors, successResponse } from '@/lib/api-response'
import { canSeeInvoice, requestPlaces, visibleStudentIds } from '@/lib/places/server'
import { requestVoid } from '@/lib/payments/void'
import { withMonthLock } from '@/lib/month-close/with-lock'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'payment_voids', 'read')) return errors.forbidden()
  const status = new URL(request.url).searchParams.get('status') === 'ALL' ? undefined : 'PENDING'
  const visible = await visibleStudentIds(await requestPlaces(session.user))
  const rows = await prisma.paymentVoid.findMany({
    where: { ...(status ? { status } : {}), ...(visible ? { studentId: { in: visible } } : {}) },
    orderBy: { createdAt: 'desc' }, take: 200,
  })
  const [students, users, pays] = await Promise.all([
    prisma.student.findMany({ where: { id: { in: rows.map((r) => r.studentId) } }, select: { id: true, firstName: true, lastName: true, registrationNumber: true } }),
    prisma.user.findMany({ where: { id: { in: rows.flatMap((r) => [r.requestedById, r.decidedById]).filter((x): x is string => !!x) } }, select: { id: true, displayName: true, email: true } }),
    prisma.feePayment.findMany({ where: { id: { in: rows.map((r) => r.paymentId) } }, select: { id: true, paymentDate: true, paymentMethod: true, source: true, receivedBy: true, invoice: { select: { challanNumber: true, month: true } } } }),
  ])
  const S = new Map(students.map((s) => [s.id, s])), U = new Map(users.map((u) => [u.id, u.displayName || u.email])), P = new Map(pays.map((p) => [p.id, p]))
  return successResponse(rows.map((r) => ({
    ...r, amount: Number(r.amount),
    student: S.get(r.studentId) ?? null, payment: P.get(r.paymentId) ?? null,
    requestedBy: U.get(r.requestedById) ?? null, decidedBy: r.decidedById ? U.get(r.decidedById) ?? null : null,
    mine: r.requestedById === session.user.id,
  })))
}

const body = z.object({ paymentId: z.string().min(1).max(40), reason: z.string().trim().min(5).max(1000) })

async function POST_(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'payment_voids', 'create')) return errors.forbidden()
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const p = await prisma.feePayment.findUnique({ where: { id: parsed.data.paymentId }, select: { invoiceId: true } })
  if (!p) return errors.notFound('Payment')
  if (!(await canSeeInvoice(session.user, p.invoiceId))) return errors.forbidden()
  const r = await requestVoid(parsed.data.paymentId, session.user.id, parsed.data.reason)
  if (r.ok === false) return errorResponse(r.code ?? 'VOID_REFUSED', r.message, r.status)
  return createdResponse(r)
}
export const POST = withMonthLock(POST_)
