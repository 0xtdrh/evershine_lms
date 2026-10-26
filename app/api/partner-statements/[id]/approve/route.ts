/** Partners part 1-B: POST /api/partner-statements/[id]/approve — freeze the statement (rest of earlier ones carried in). */

import type { Role } from '@prisma/client'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { approveStatement } from '@/lib/partners/statement-engine'
import { outcome } from '@/lib/partners/http'
import { withMonthLock } from '@/lib/month-close/with-lock'

async function POST_(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partner_finance', 'approve')
  if (denied) return denied
  return outcome(await approveStatement(session.user.id, (await params).id), 'Approved')
}

// a03: a write into a closed month answers 409 with the reason
export const POST = withMonthLock(POST_)
