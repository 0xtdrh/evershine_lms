/**
 * GET  /api/family-accounts?q=&filter=ALL|WEBSITE|STAFF|NO_BOOKING — six phases 1-A: family accounts (family_accounts:read, places).
 * POST /api/family-accounts — staff make the account of an offline family + a link to choose its password (family_accounts:create).
 */

import { NextRequest } from 'next/server'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { staffAccountSchema } from '@/lib/accounts/rules'
import { staffCreateAccount } from '@/lib/accounts/engine'
import { accountError } from '@/lib/accounts/http'
import { listAccounts, staffSession, type AccountFilter } from '@/lib/accounts/staff'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const s = await staffSession('read')
  if (s.error) return s.error
  const sp = request.nextUrl.searchParams
  const filter = (['ALL', 'WEBSITE', 'STAFF', 'PARTNER', 'NO_BOOKING'].includes(sp.get('filter') ?? '') ? sp.get('filter') : 'ALL') as AccountFilter
  return successResponse(await listAccounts(s.user, { q: sp.get('q'), filter }))
}

export async function POST(request: NextRequest) {
  const s = await staffSession('create')
  if (s.error) return s.error
  const parsed = staffAccountSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try {
    const r = await staffCreateAccount(s.user.id, parsed.data)
    return createdResponse({ guardianId: r.guardianId, link: r.path, expiresAt: r.expiresAt })
  } catch (e) {
    return accountError(e)
  }
}
