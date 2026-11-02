/** a02 M3: GET ?campusId=&levelId=&slots=[{dayOfWeek,time,mode}] — instructors of the place, qualified for the level and free at those times. */

import { NextRequest } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { instructorsFor, type SlotInput } from '@/lib/one-to-one/engine'
import { oneToOneUser } from '@/lib/one-to-one/http'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const u = await oneToOneUser('create')
  if ('error' in u) return u.error
  const sp = request.nextUrl.searchParams
  const campusId = sp.get('campusId'), levelId = sp.get('levelId')
  if (!campusId || !levelId) return errors.badRequest('Choose the place and the level')
  let slots: SlotInput[]
  try { slots = JSON.parse(sp.get('slots') ?? '[]') } catch { return errors.badRequest('Bad times') }
  if (!Array.isArray(slots) || !slots.length) return successResponse([])
  return successResponse(await instructorsFor({ campusId, levelId, slots }))
}
