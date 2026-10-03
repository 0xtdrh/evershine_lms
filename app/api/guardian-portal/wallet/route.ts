/**
 * GET /api/guardian-portal/wallet — the signed-in parent's children's wallets (phase B):
 * balance, recent movements, pending top-ups, minimum top-up, whether withdrawals are
 * allowed, and what is needed to top up (accounts, online + fee, payout methods).
 */

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { getChildrenForGuardianUser } from '@/lib/academic/guardian'
import { listPaymentMethods, publicPaymentAccounts } from '@/lib/fees/payment-settings'
import { isPaymobConfigured } from '@/lib/payments/paymob'
import { getWalletSettings, minimumTopUp, walletBalance, withdrawalAllowed } from '@/lib/wallet/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!['PARENT', 'GUARDIAN'].includes(session.user.role)) return errors.forbidden()
  const children = await getChildrenForGuardianUser(session.user.id)
  const ids = children.map((c) => c.id)
  const [settings, accounts, methods, flags] = await Promise.all([
    getWalletSettings(),
    publicPaymentAccounts(),
    listPaymentMethods(true),
    prisma.student.findMany({ where: { id: { in: ids } }, select: { id: true, walletVisibleToStudent: true } }),
  ])
  const visible = new Map(flags.map((f) => [f.id, f.walletVisibleToStudent]))
  const wallets = await Promise.all(children.map(async (c) => {
    const [balance, tx, pending, min, canWithdraw] = await Promise.all([
      walletBalance(c.id),
      prisma.walletTransaction.findMany({ where: { studentId: c.id }, orderBy: { createdAt: 'desc' }, take: 15 }),
      prisma.walletTopUp.findMany({ where: { studentId: c.id, status: 'PENDING' }, select: { id: true, amount: true, createdAt: true } }),
      minimumTopUp(c.id),
      withdrawalAllowed(c.id),
    ])
    return {
      studentId: c.id,
      name: `${c.firstName} ${c.lastName}`,
      balance,
      visibleToStudent: visible.get(c.id) ?? true,
      minimumTopUp: min,
      withdrawalAllowed: canWithdraw,
      pendingTopUps: pending.map((p) => ({ ...p, amount: Number(p.amount) })),
      transactions: tx.map((t) => ({ id: t.id, type: t.type, amount: Number(t.amount), note: t.note, createdAt: t.createdAt, topUpId: t.topUpId, paymentId: t.paymentId })),
    }
  }))
  return successResponse({
    wallets,
    online: { enabled: isPaymobConfigured(), feePercent: settings.paymobFeePercent, feeFixed: settings.paymobFeeFixed },
    accounts,
    payoutMethods: methods.map((m) => m.name),
  })
}
