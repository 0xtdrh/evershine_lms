/**
 * GET    /api/teachers/[id]/qualified-subjects — list what this teacher can teach
 * POST   /api/teachers/[id]/qualified-subjects — add one (track, course, or level)
 * DELETE /api/teachers/[id]/qualified-subjects?rowId=... — remove one
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import type { Role } from '@prisma/client'

const bodySchema = z.object({
  trackId: z.string().min(1).optional(),
  subjectId: z.string().min(1).optional(),
  levelId: z.string().min(1).optional(),
}).refine(
  (d) => [d.trackId, d.subjectId, d.levelId].filter(Boolean).length === 1,
  { message: 'Provide exactly one of trackId, subjectId, or levelId' }
)

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'teachers', 'read')
  if (denied) return denied

  const { id } = await params
  const rows = await prisma.teacherQualifiedSubject.findMany({
    where: { teacherId: id },
    include: {
      track: { select: { id: true, name: true } },
      subject: { select: { id: true, name: true } },
      level: { select: { id: true, name: true, subject: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse(rows)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'teachers', 'update')
  if (denied) return denied

  const { id } = await params
  const teacher = await prisma.teacher.findUnique({ where: { id }, select: { id: true } })
  if (!teacher) return errors.notFound('Teacher')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const row = await prisma.teacherQualifiedSubject.create({
    data: {
      teacherId: id,
      trackId: parsed.data.trackId ?? null,
      subjectId: parsed.data.subjectId ?? null,
      levelId: parsed.data.levelId ?? null,
    },
  })

  return createdResponse(row, 'Qualification added')
}

export async function DELETE(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'teachers', 'update')
  if (denied) return denied

  const rowId = request.nextUrl.searchParams.get('rowId')
  if (!rowId) return errors.validation({ errors: [{ path: ['rowId'], message: 'rowId is required' }] } as never)

  await prisma.teacherQualifiedSubject.delete({ where: { id: rowId } })
  return successResponse({ id: rowId, deleted: true })
}
