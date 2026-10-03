/**
 * GET /api/students/[id]/wallet — wallet balance + history (+ phase B details for staff:
 * siblings for transfers, minimum top-up, withdrawal allowed, pending top-ups/withdrawals).
 * Staff with wallet/refund/fee access, or the student (if the parent allows) / their parent.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { canViewReceipt } from '@/lib/fees/receipt'
import { minimumTopUp, siblingsOf, walletBalance, withdrawalAllowed } from '@/lib/wallet/engine'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  const role = session.user.role as Role
  const staff = checkPermission(role, 'wallet', 'read') || checkPermission(role, 'refunds', 'read')
  const allowed = staff || (await canViewReceipt({ id: session.user.id, role: session.user.role }, id))
  if (!allowed) return errors.forbidden()
  if (role === 'STUDENT') {
    const s = await prisma.student.findUnique({ where: { id }, select: { walletVisibleToStudent: true } })
    if (!s?.walletVisibleToStudent) return successResponse({ hidden: true, balance: 0, transactions: [] })
  }
  const [balance, transactions] = await Promise.all([
    walletBalance(id),
    prisma.walletTransaction.findMany({ where: { studentId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ])
  const topUpIds = transactions.map((t) => t.topUpId).filter((x): x is string => !!x)
  const topUps = topUpIds.length ? await prisma.walletTopUp.findMany({ where: { id: { in: topUpIds } }, select: { id: true, topUpNumber: true, method: true, source: true } }) : []
  const T = new Map(topUps.map((t) => [t.id, t]))
  const base = {
    balance,
    transactions: transactions.map((t) => ({ ...t, amount: Number(t.amount), topUp: t.topUpId ? T.get(t.topUpId) ?? null : null })),
  }
  if (!staff) return successResponse(base)

  const [siblingIds, min, canWithdraw, pendingTopUps, pendingWithdrawals] = await Promise.all([
    siblingsOf(id),
    minimumTopUp(id),
    withdrawalAllowed(id),
    prisma.walletTopUp.count({ where: { studentId: id, status: 'PENDING' } }),
    prisma.walletWithdrawal.findMany({ where: { studentId: id, status: 'PENDING' }, select: { id: true, amount: true, payoutMethod: true, createdAt: true } }),
  ])
  const siblings = siblingIds.length ? await prisma.student.findMany({ where: { id: { in: siblingIds }, isActive: true }, select: { id: true, firstName: true, lastName: true } }) : []
  return successResponse({
    ...base,
    siblings: siblings.map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName}` })),
    minimumTopUp: min,
    withdrawalAllowed: canWithdraw,
    pendingTopUps,
    pendingWithdrawals: pendingWithdrawals.map((w) => ({ ...w, amount: Number(w.amount) })),
  })
}
