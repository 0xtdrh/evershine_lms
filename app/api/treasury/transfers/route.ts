/** GET /api/treasury/transfers — FIN-1 list; POST { fromAccountId, toAccountId, amount, date?, note? } — move money. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { treasuryError, treasuryUser } from '@/lib/treasury/http'
import { createTransfer, listTransfers } from '@/lib/treasury/engine'
import { withMonthLock } from '@/lib/month-close/with-lock'

export const dynamic = 'force-dynamic'

const schema = z.object({ fromAccountId: z.string().min(1), toAccountId: z.string().min(1), amount: z.number().positive().max(100000000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(), note: z.string().max(300).optional().nullable() })

export async function GET() {
  const u = await treasuryUser('read')
  if ('error' in u) return u.error
  return successResponse(await listTransfers(u.user))
}

async function POST_(request: NextRequest) {
  const u = await treasuryUser('create')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { return createdResponse(await createTransfer(u.user, parsed.data as { fromAccountId: string; toAccountId: string; amount: number; date?: string | null; note?: string | null })) } catch (e) { return treasuryError(e) }
}

// a03: a write into a closed month answers 409 with the reason
export const POST = withMonthLock(POST_)
