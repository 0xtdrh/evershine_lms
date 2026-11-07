/** GET /api/payment-voids/check?paymentId= — can this payment be cancelled now (for the button)? payment_voids:create */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { canSeeInvoice } from '@/lib/places/server'
import { voidCheck } from '@/lib/payments/void'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'payment_voids', 'create')) return errors.forbidden()
  const paymentId = new URL(request.url).searchParams.get('paymentId') ?? ''
  const p = await prisma.feePayment.findUnique({ where: { id: paymentId }, select: { invoiceId: true } })
  if (!p) return errors.notFound('Payment')
  if (!(await canSeeInvoice(session.user, p.invoiceId))) return errors.forbidden()
  return successResponse(await voidCheck(paymentId))
}
