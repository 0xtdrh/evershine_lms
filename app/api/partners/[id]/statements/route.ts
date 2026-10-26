/**
 * Partners part 1-B: GET /api/partners/[id]/statements — the statements of a partner (with payments and the rest);
 * POST { campusId?, from, to } — make a draft from the deal and the system's numbers. RBAC `partner_finance`.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { listStatements, makeStatement } from '@/lib/partners/statement-engine'
import { makeStatementSchema } from '@/lib/partners/validation'
import { outcome } from '@/lib/partners/http'
import { withMonthLock } from '@/lib/month-close/with-lock'

type P = { params: Promise<{ id: string }> }

export async function GET(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partner_finance', 'read')
  if (denied) return denied
  return successResponse(await listStatements((await params).id))
}

async function POST_(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'partner_finance', 'create')
  if (denied) return denied
  const parsed = makeStatementSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  const r = await makeStatement(session.user.id, (await params).id, d.campusId || null, new Date(`${d.from}T00:00:00.000Z`), new Date(`${d.to}T00:00:00.000Z`))
  if (!r.ok) return outcome(r)
  return createdResponse((r as { value: { id: string } }).value, 'Statement made (draft)')
}

// a03: a write into a closed month answers 409 with the reason
export const POST = withMonthLock(POST_)
