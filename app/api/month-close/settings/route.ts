/** GET / PUT /api/month-close/settings — a03: automatic close (on / off, which day) and the reminder day. Super Admin / Admin save. */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { getMonthCloseSettings, saveMonthCloseSettings } from '@/lib/month-close/engine'
import { monthCloseUser } from '@/lib/month-close/http'

const schema = z.object({ autoLock: z.boolean().optional(), autoLockDay: z.number().int().min(1).max(28).optional(), remindDay: z.number().int().min(1).max(28).optional() })

export async function GET() {
  const u = await monthCloseUser('read')
  if ('error' in u) return u.error
  return successResponse(await getMonthCloseSettings())
}

export async function PUT(request: NextRequest) {
  const u = await monthCloseUser('update')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveMonthCloseSettings(parsed.data, u.user.id))
}
