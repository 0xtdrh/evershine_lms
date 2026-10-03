/** GET /api/student-portal/wallet — the signed-in student's wallet, only if the parent allows it (phase B). */

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { walletBalance } from '@/lib/wallet/engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (session.user.role !== 'STUDENT') return errors.forbidden()
  const s = await prisma.student.findFirst({ where: { userId: session.user.id }, select: { id: true, walletVisibleToStudent: true } })
  if (!s) return errors.notFound('Student')
  if (!s.walletVisibleToStudent) return successResponse({ hidden: true })
  const [balance, tx] = await Promise.all([
    walletBalance(s.id),
    prisma.walletTransaction.findMany({ where: { studentId: s.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ])
  return successResponse({
    hidden: false,
    studentId: s.id,
    balance,
    transactions: tx.map((t) => ({ id: t.id, type: t.type, amount: Number(t.amount), note: t.note, createdAt: t.createdAt, topUpId: t.topUpId, paymentId: t.paymentId })),
  })
}
