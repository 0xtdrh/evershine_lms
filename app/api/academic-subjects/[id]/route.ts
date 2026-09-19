/**
 * GET   /api/academic-subjects/[id]  — view a course, with its track and levels
 * PATCH /api/academic-subjects/[id]  — update a course, including its trackId
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import type { Role } from '@prisma/client'

const updateSubjectSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  trackId: z.string().min(1).optional().nullable(),
})

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'subject_offerings', 'read')
  if (denied) return denied

  const { id } = await params
  const subject = await prisma.academicSubject.findUnique({
    where: { id },
    include: {
      track: { select: { id: true, name: true } },
      levels: { orderBy: { order: 'asc' } },
    },
  })
  if (!subject) return errors.notFound('Course')

  return successResponse(subject)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'subject_offerings', 'update')
  if (denied) return denied

  const { id } = await params
  const existing = await prisma.academicSubject.findUnique({ where: { id } })
  if (!existing) return errors.notFound('Course')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }

  const parsed = updateSubjectSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  if (parsed.data.trackId) {
    const track = await prisma.track.findUnique({ where: { id: parsed.data.trackId }, select: { id: true } })
    if (!track) return errors.notFound('Track')
  }

  const subject = await prisma.academicSubject.update({
    where: { id },
    data: parsed.data,
    include: { track: { select: { id: true, name: true } } },
  })

  return successResponse(subject)
}
