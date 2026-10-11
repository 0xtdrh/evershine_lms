/** R2: instructor performance settings — GET (managers + instructors), PUT { teacherCanSee } (Super Admin / Admin). */

import type { Role } from '@prisma/client'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { getPerformanceSettings, savePerformanceSettings } from '@/lib/teachers/performance'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'TEACHER'].includes(session.user.role)) return errors.forbidden()
  return successResponse(await getPerformanceSettings())
}

export async function PUT(req: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') return errors.forbidden()
  const parsed = z.object({ teacherCanSee: z.boolean() }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const v = { teacherCanSee: !!parsed.data.teacherCanSee }
  await savePerformanceSettings(v, session.user.id)
  return successResponse(v)
}
