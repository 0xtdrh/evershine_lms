/** GET / PUT /api/treasury/settings — FIN-1: daily count required, after what hour, tolerance, transfers need approval. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { treasuryUser } from '@/lib/treasury/http'
import { getTreasurySettings, saveTreasurySettings } from '@/lib/treasury/engine'

const schema = z.object({ dailyCloseRequired: z.boolean().optional(), closeAfterHour: z.number().int().min(0).max(23).optional(), tolerance: z.number().min(0).max(100000).optional(), transferNeedsApproval: z.boolean().optional(), branchToCompany: z.boolean().optional() })

export async function GET() {
  const u = await treasuryUser('read')
  if ('error' in u) return u.error
  return successResponse(await getTreasurySettings())
}

export async function PUT(request: NextRequest) {
  const u = await treasuryUser('update')
  if ('error' in u) return u.error
  if (!['SUPER_ADMIN', 'ADMIN'].includes(u.user.role)) return errors.forbidden()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveTreasurySettings(parsed.data, u.user.id))
}
