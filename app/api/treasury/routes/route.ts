/**
 * GET /api/treasury/routes — FIN-1: payment methods × branches → account (Settings → Payments).
 * PUT { method, campusId|null, accountId|null } — set (or clear) where a payment method lands; waiting movements are placed.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { treasuryError, treasuryUser } from '@/lib/treasury/http'
import { listRoutes, setRoute } from '@/lib/treasury/engine'
import { withMonthLock } from '@/lib/month-close/with-lock'

export const dynamic = 'force-dynamic'

const schema = z.object({ method: z.string().trim().min(1).max(50), campusId: z.string().max(40).nullable(), accountId: z.string().max(40).nullable() })

export async function GET() {
  const u = await treasuryUser('read')
  if ('error' in u) return u.error
  return successResponse(await listRoutes(u.user))
}

async function PUT_(request: NextRequest) {
  const u = await treasuryUser('update')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data as { method: string; campusId: string | null; accountId: string | null }
  try { await setRoute(u.user, d.method, d.campusId, d.accountId); return successResponse(await listRoutes(u.user)) } catch (e) { return treasuryError(e) }
}

// a03: a write into a closed month answers 409 with the reason
export const PUT = withMonthLock(PUT_)
