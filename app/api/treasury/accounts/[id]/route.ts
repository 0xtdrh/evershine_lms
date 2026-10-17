/** PATCH /api/treasury/accounts/[id] — FIN-1: edit / deactivate a money account. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { treasuryError, treasuryUser } from '@/lib/treasury/http'
import { saveAccount, type AccountInput } from '@/lib/treasury/engine'
import { ACCOUNT_KINDS } from '@/lib/treasury/rules'

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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await treasuryUser('update')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { return successResponse(await saveAccount(u.user, parsed.data as AccountInput, (await params).id)) } catch (e) { return treasuryError(e) }
}
