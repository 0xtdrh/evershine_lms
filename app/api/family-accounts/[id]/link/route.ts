/**
 * POST /api/family-accounts/[id]/link — six phases 1-A: a new one-time link for the family to choose its password
 * (an offline family, a forgotten password, an old account made by an admission approval). Older links stop working.
 */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { newSetupLink } from '@/lib/accounts/engine'
import { canSeeAccount, staffSession } from '@/lib/accounts/staff'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await staffSession('update')
  if (s.error) return s.error
  const { id } = await params
  if (!(await canSeeAccount(s.user, id))) return errors.notFound('Account')
  const r = await newSetupLink(id, s.user.id)
  return successResponse({ link: r.path, expiresAt: r.expiresAt })
}
