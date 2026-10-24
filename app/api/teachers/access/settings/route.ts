/** Instructor access settings — GET (staff), PUT { finishedGroupDays } (Super Admin / Admin). */

import type { Role } from '@prisma/client'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { forgetAllPlaces } from '@/lib/places/server'
import { getTeacherAccessSettings, saveTeacherAccessSettings } from '@/lib/teachers/access-settings'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  return successResponse(await getTeacherAccessSettings())
}

export async function PUT(req: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') return errors.forbidden()
  const parsed = z.object({ finishedGroupDays: z.number().int().min(0).max(365) }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  await saveTeacherAccessSettings({ finishedGroupDays: parsed.data.finishedGroupDays }, session.user.id)
  forgetAllPlaces()
  return successResponse(await getTeacherAccessSettings())
}
