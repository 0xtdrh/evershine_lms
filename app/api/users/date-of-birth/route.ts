/**
 * Phase C: birth date for parents and non-teacher staff (User.dateOfBirth, optional).
 * GET  ?guardianIds=a,b — staff: those parents' birth dates; no query: your own
 * PUT  { dateOfBirth: 'YYYY-MM-DD' | null, guardianId? , userId? }
 *      own account: anyone · a parent: staff with students:update · a staff account: users:update
 * Students and instructors keep the birth date of their own record (not this one).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors, successResponse } from '@/lib/api-response'
import { checkPermission } from '@/lib/rbac'

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const ids = (new URL(request.url).searchParams.get('guardianIds') ?? '').split(',').filter(Boolean)
  if (!ids.length) {
    const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { dateOfBirth: true } })
    return successResponse({ dateOfBirth: day(u?.dateOfBirth ?? null) })
  }
  if (!checkPermission(session.user.role as Role, 'students', 'read')) return errors.forbidden()
  const rows = await prisma.guardian.findMany({ where: { id: { in: ids.slice(0, 20) } }, select: { id: true, user: { select: { dateOfBirth: true } } } })
  return successResponse(Object.fromEntries(rows.map((g) => [g.id, day(g.user?.dateOfBirth ?? null)])))
}

const schema = z.object({
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  guardianId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
})

export async function PUT(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = schema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const { dateOfBirth, guardianId, userId } = parsed.data
  if (dateOfBirth) {
    const t = Date.parse(`${dateOfBirth}T00:00:00.000Z`)
    if (isNaN(t) || t > Date.now() || t < Date.parse('1920-01-01')) return errors.badRequest('Enter a real date of birth')
  }
  let target = session.user.id
  if (guardianId) {
    if (!checkPermission(role, 'students', 'update')) return errors.forbidden()
    const g = await prisma.guardian.findUnique({ where: { id: guardianId }, select: { userId: true } })
    if (!g) return errors.notFound('Parent')
    target = g.userId
  } else if (userId && userId !== session.user.id) {
    if (!checkPermission(role, 'users', 'update')) return errors.forbidden()
    target = userId
  }
  await prisma.user.update({ where: { id: target }, data: { dateOfBirth: dateOfBirth ? new Date(`${dateOfBirth}T00:00:00.000Z`) : null } })
  return successResponse({ dateOfBirth }, 'Saved')
}
