/** a02 M3 batch 3, staff: PATCH { slots?, teacherId?, teacherRate?, minutes?, force? } — change the fixed time, the instructor or the length (same rules as booking). */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { MODES } from '@/lib/delivery/modes'
import { changeOneToOne, type ChangeInput } from '@/lib/one-to-one/engine'
import { oneToOneError, oneToOneUser } from '@/lib/one-to-one/http'

const schema = z.object({
  slots: z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), time: z.string().regex(/^\d{2}:\d{2}$/), mode: z.enum(MODES).optional(), roomId: z.string().min(1).nullish() })).min(1).max(7).optional(),
  teacherId: z.string().min(1).optional(), teacherRate: z.number().min(0).nullish(), minutes: z.number().int().min(10).max(300).nullish(), force: z.boolean().optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await oneToOneUser('update')
  if ('error' in u) return u.error
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const { id } = await params
  try { return successResponse(await changeOneToOne(u.user, id, parsed.data as ChangeInput)) } catch (e) { return oneToOneError(e) }
}
