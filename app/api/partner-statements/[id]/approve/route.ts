/** Partners part 1-B: POST /api/partner-statements/[id]/approve — freeze the statement (rest of earlier ones carried in). */

import type { Role } from '@prisma/client'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { approveStatement } from '@/lib/partners/statement-engine'
import { outcome } from '@/lib/partners/http'

export async function POST(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partner_finance', 'approve')
  if (denied) return denied
  return outcome(await approveStatement(session.user.id, (await params).id), 'Approved')
}
