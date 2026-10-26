/** GET /api/treasury/counts — FIN-1 list; POST { accountId, counted, note? } — end-of-day cash count. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { treasuryError, treasuryUser } from '@/lib/treasury/http'
import { createCount, listCounts } from '@/lib/treasury/engine'
import { withMonthLock } from '@/lib/month-close/with-lock'

export const dynamic = 'force-dynamic'

const schema = z.object({ accountId: z.string().min(1), counted: z.number().min(0).max(100000000), note: z.string().max(300).optional().nullable() })

export async function GET() {
  const u = await treasuryUser('read')
  if ('error' in u) return u.error
  return successResponse(await listCounts(u.user))
}

async function POST_(request: NextRequest) {
  const u = await treasuryUser('create')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { return createdResponse(await createCount(u.user, parsed.data as { accountId: string; counted: number; note?: string | null })) } catch (e) { return treasuryError(e) }
}

// a03: a write into a closed month answers 409 with the reason
export const POST = withMonthLock(POST_)
