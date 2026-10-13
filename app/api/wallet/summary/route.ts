/** GET /api/wallet/summary — prepaid money (all wallet balances) + items waiting, for the accounts pages (phase B). */

import { requestPlaces, visibleStudentIds } from '@/lib/places/server'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { prepaidTotal } from '@/lib/wallet/engine'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'wallet', 'read')
  if (denied) return denied
  // M0: students of the person's places (null = every place)
  const ids = await visibleStudentIds(await requestPlaces(session.user))
  const scope = ids ? { studentId: { in: ids } } : {}
  const [prepaid, pendingTopUps, pendingWithdrawals] = await Promise.all([
    prepaidTotal(null, ids),
    prisma.walletTopUp.count({ where: { status: 'PENDING', ...scope } }),
    prisma.walletWithdrawal.count({ where: { status: 'PENDING', ...scope } }),
  ])
  return successResponse({ prepaidTotal: prepaid, pendingTopUps, pendingWithdrawals })
}
