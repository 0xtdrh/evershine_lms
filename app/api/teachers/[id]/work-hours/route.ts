/**
 * GET /api/teachers/[id]/work-hours — a02 batch 4: an instructor's working hours per weekday + his weekly sessions.
 * PUT { rows: [{ dayOfWeek, fromTime, toTime, kind: SHIFT|AVAILABLE, campusId|null, onlineOnly }] } — replace them.
 * Staff with teachers:update (instructors of their places) change them; the instructor himself may read his own.
 * No rows = always available.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { canSeeTeacher } from '@/lib/places/server'
import { saveTeacherHours, teacherHours, teacherSlots } from '@/lib/teachers/availability'

type Ctx = { params: Promise<{ id: string }> }

async function load(id: string) {
  return prisma.teacher.findFirst({ where: { OR: [{ id }, { userId: id }] }, select: { id: true, userId: true, firstName: true, lastName: true } })
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const t = await load((await params).id)
  if (!t) return errors.notFound('Instructor')
  const own = t.userId === session.user.id
  if (!own && !(checkPermission(session.user.role, 'teachers', 'read') && (await canSeeTeacher(session.user, t.id)))) return errors.forbidden()
  const [rows, sessions] = await Promise.all([teacherHours(t.id), teacherSlots(t.id)])
  return successResponse({ teacher: { id: t.id, name: `${t.firstName} ${t.lastName}` }, rows, sessions, canEdit: checkPermission(session.user.role, 'teachers', 'update') })
}

const row = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  fromTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  toTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  kind: z.enum(['SHIFT', 'AVAILABLE']).default('SHIFT'),
  campusId: z.string().min(1).nullable().optional(),
  onlineOnly: z.boolean().default(false),
})

export async function PUT(request: NextRequest, { params }: Ctx) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  if (!checkPermission(session.user.role, 'teachers', 'update')) return errors.forbidden()
  const t = await load((await params).id)
  if (!t) return errors.notFound('Instructor')
  if (!(await canSeeTeacher(session.user, t.id))) return errors.forbidden()
  const parsed = z.object({ rows: z.array(row).max(60) }).safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const rows = await saveTeacherHours(t.id, parsed.data.rows!.map((r) => ({ dayOfWeek: r.dayOfWeek!, fromTime: r.fromTime!, toTime: r.toTime!, kind: r.kind, campusId: r.campusId ?? null, onlineOnly: !!r.onlineOnly })))
  return successResponse({ rows }, 'Saved · اتحفظ')
}
