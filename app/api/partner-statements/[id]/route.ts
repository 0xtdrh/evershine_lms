/**
 * Partners part 1-B: GET /api/partner-statements/[id] — one statement; PATCH { manualLines?, notes? } — draft only:
 * recalculate from the current numbers; DELETE — remove a draft. RBAC `partner_finance`.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { deleteDraft, getStatement, recalculate } from '@/lib/partners/statement-engine'
import { statementEditSchema } from '@/lib/partners/validation'
import { outcome } from '@/lib/partners/http'
import { withMonthLock } from '@/lib/month-close/with-lock'

type P = { params: Promise<{ id: string }> }

export async function GET(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partner_finance', 'read')
  if (denied) return denied
  const s = await getStatement((await params).id)
  return s ? successResponse(s) : errors.notFound('Statement')
}

async function PATCH_(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partner_finance', 'create')
  if (denied) return denied
  const parsed = statementEditSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return errors.validation(parsed.error)
  return outcome(await recalculate(session.user.id, (await params).id, parsed.data.manualLines as never, parsed.data.notes), 'Recalculated')
}

async function DELETE_(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partner_finance', 'create')
  if (denied) return denied
  return outcome(await deleteDraft(session.user.id, (await params).id), 'Deleted')
}

// a03: a write into a closed month answers 409 with the reason
export const PATCH = withMonthLock(PATCH_)
export const DELETE = withMonthLock(DELETE_)
