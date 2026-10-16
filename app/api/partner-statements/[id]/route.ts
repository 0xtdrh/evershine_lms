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

type P = { params: Promise<{ id: string }> }

export async function GET(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partner_finance', 'read')
  if (denied) return denied
  const s = await getStatement((await params).id)
  return s ? successResponse(s) : errors.notFound('Statement')
}

export async function PATCH(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partner_finance', 'create')
  if (denied) return denied
  const parsed = statementEditSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return errors.validation(parsed.error)
  return outcome(await recalculate(session.user.id, (await params).id, parsed.data.manualLines as never, parsed.data.notes), 'Recalculated')
}

export async function DELETE(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partner_finance', 'create')
  if (denied) return denied
  return outcome(await deleteDraft(session.user.id, (await params).id), 'Deleted')
}
