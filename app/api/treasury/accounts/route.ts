/** POST /api/treasury/accounts — FIN-1: add a money account (cash box, bank, InstaPay, wallet, gateway). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createdResponse, errors } from '@/lib/api-response'
import { treasuryError, treasuryUser } from '@/lib/treasury/http'
import { saveAccount, type AccountInput } from '@/lib/treasury/engine'
import { ACCOUNT_KINDS } from '@/lib/treasury/rules'
import { withMonthLock } from '@/lib/month-close/with-lock'

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  kind: z.enum(ACCOUNT_KINDS),
  campusId: z.string().max(40).optional().nullable(),
  openingBalance: z.number().min(-100000000).max(100000000).optional(),
  openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  isActive: z.boolean().optional(),
  notes: z.string().max(300).optional().nullable(),
  sortOrder: z.number().int().optional(),
})

async function POST_(request: NextRequest) {
  const u = await treasuryUser('update')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { return createdResponse(await saveAccount(u.user, parsed.data as AccountInput)) } catch (e) { return treasuryError(e) }
}

// a03: a write into a closed month answers 409 with the reason
export const POST = withMonthLock(POST_)
