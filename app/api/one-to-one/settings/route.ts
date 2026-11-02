/** a02 M3 batch 2: One-to-One settings. GET (read) / PUT (update, every place): portal open, assign without asking, reply hours, parent picks an instructor, parent-present age. */

import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { oneToOneUser } from '@/lib/one-to-one/http'
import { getOneToOneSettings, saveOneToOneSettings } from '@/lib/one-to-one/requests'
import { loadPlaces } from '@/lib/places/server'

export const dynamic = 'force-dynamic'

const schema = z.object({
  portalOpen: z.boolean().optional(), assignWithoutAsking: z.boolean().optional(), replyHours: z.number().min(1).max(168).optional(),
  parentPicksInstructor: z.boolean().optional(), parentPresentUnderAge: z.number().min(0).max(25).optional(),
  cancelHours: z.number().min(0).max(720).optional(), postponesPerMonth: z.number().min(0).max(50).optional(), noShowWaitMinutes: z.number().min(0).max(120).optional(),
  noShowPayPct: z.number().min(0).max(100).optional(), noShowLimit: z.number().min(1).max(50).optional(),
})

export async function GET() {
  const u = await oneToOneUser('read')
  if ('error' in u) return u.error
  return successResponse(await getOneToOneSettings())
}

export async function PUT(request: Request) {
  const u = await oneToOneUser('update')
  if ('error' in u) return u.error
  if (!(await loadPlaces(u.user as never)).all) return errors.forbidden('Company settings need every place')
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  return successResponse(await saveOneToOneSettings(parsed.data, u.user.id))
}
