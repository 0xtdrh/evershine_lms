/** GET /api/wallet/summary — prepaid money (all wallet balances) + items waiting, for the accounts pages (phase B). */

import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { prepaidTotal } from '@/lib/wallet/engine'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'wallet', 'read')
  if (denied) return denied
  const campusId = campusScope(role, session.user.campusId, null)
  const ids = campusId ? (await prisma.student.findMany({ where: { campusId }, select: { id: true } })).map((s) => s.id) : null
  const scope = ids ? { studentId: { in: ids } } : {}
  const [prepaid, pendingTopUps, pendingWithdrawals] = await Promise.all([
    prepaidTotal(campusId),
    prisma.walletTopUp.count({ where: { status: 'PENDING', ...scope } }),
    prisma.walletWithdrawal.count({ where: { status: 'PENDING', ...scope } }),
  ])
  return successResponse({ prepaidTotal: prepaid, pendingTopUps, pendingWithdrawals })
}
