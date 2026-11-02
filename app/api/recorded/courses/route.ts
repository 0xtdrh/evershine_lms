/** a02 M4 batch 1: the recorded-course catalogue. GET — every course. POST — add or change the course of a level (recorded_courses:update, every place). */

import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { listCourses, saveCourse, type CourseInput } from '@/lib/recorded/engine'
import { recordedError, recordedUser } from '@/lib/recorded/http'
import { loadPlaces } from '@/lib/places/server'

export const dynamic = 'force-dynamic'

const money = z.number().min(0).max(10_000_000).nullish()
const schema = z.object({
  levelId: z.string().min(1), subscriptionPrice: money, subscriptionDays: z.number().int().min(1).max(3650).nullish(), oneTimePrice: money,
  openMode: z.enum(['ALL', 'PREVIOUS']).optional(), examRequired: z.boolean().optional(), autoReveal: z.boolean().optional(), isActive: z.boolean().optional(), videoDevices: z.number().int().min(1).max(10).nullish(),
})

export async function GET() {
  const u = await recordedUser('read')
  if ('error' in u) return u.error
  return successResponse(await listCourses())
}

export async function POST(request: Request) {
  const u = await recordedUser('update')
  if ('error' in u) return u.error
  if (!(await loadPlaces(u.user as never)).all) return errors.forbidden('The catalogue needs every place')
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  try { return successResponse(await saveCourse(parsed.data as CourseInput)) } catch (e) { return recordedError(e) }
}
