/** GET /api/family-accounts/[id] — six phases 1-A: one family account, its people, opened courses, last password link. */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { accountDetail, canSeeAccount, staffSession } from '@/lib/accounts/staff'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await staffSession('read')
  if (s.error) return s.error
  const { id } = await params
  if (!(await canSeeAccount(s.user, id))) return errors.notFound('Account')
  const d = await accountDetail(id)
  return d ? successResponse(d) : errors.notFound('Account')
}
