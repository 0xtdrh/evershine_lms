/**
 * GET /api/students/[id]/wallet — wallet balance + history.
 * Staff with refund access, staff with fee access, or the student / their parent.
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { canViewReceipt } from '@/lib/fees/receipt'
import { walletBalance } from '@/lib/refunds/engine'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  const allowed =
    checkPermission(session.user.role as never, 'refunds', 'read') ||
    (await canViewReceipt({ id: session.user.id, role: session.user.role }, id))
  if (!allowed) return errors.forbidden()
  const [balance, transactions] = await Promise.all([
    walletBalance(id),
    prisma.walletTransaction.findMany({ where: { studentId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ])
  return successResponse({ balance, transactions: transactions.map((t) => ({ ...t, amount: Number(t.amount) })) })
}
