/**
 * GET /api/online-payments?status= — online (Paymob) payment attempts, e.g. the
 * ones needing review (money received but not applied). Staff with fee access.
 */

import { NextRequest } from 'next/server'
import type { Prisma, Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'fee_collection', 'read') && !checkPermission(role, 'finance_settings', 'read')) return errors.forbidden()
  const status = new URL(request.url).searchParams.get('status')
  const where: Prisma.OnlinePaymentWhereInput = status ? { status } : {}
  const rows = await prisma.onlinePayment.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 })
  const invoices = await prisma.feeInvoice.findMany({
    where: { id: { in: rows.map((r) => r.invoiceId) } },
    select: { id: true, challanNumber: true, student: { select: { firstName: true, lastName: true } } },
  })
  const I = new Map(invoices.map((i) => [i.id, i]))
  return successResponse(rows.map((r) => ({ ...r, amount: Number(r.amount), invoice: I.get(r.invoiceId) ?? null })))
}
