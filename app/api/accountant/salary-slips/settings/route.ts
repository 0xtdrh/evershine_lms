/** Salary settings — GET (staff with salaries:read + instructors), PUT { teacherSeesOwnSlips } (Super Admin / Admin). */

import type { Role } from '@prisma/client'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { getSalarySettings, saveSalarySettings } from '@/lib/salaries/settings'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  if (role !== 'TEACHER' && !checkPermission(role, 'salaries', 'read')) return errors.forbidden()
  return successResponse(await getSalarySettings())
}

export async function PUT(req: Request) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') return errors.forbidden()
  const parsed = z.object({ teacherSeesOwnSlips: z.boolean() }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  await saveSalarySettings({ teacherSeesOwnSlips: parsed.data.teacherSeesOwnSlips }, session.user.id)
  return successResponse(await getSalarySettings())
}
