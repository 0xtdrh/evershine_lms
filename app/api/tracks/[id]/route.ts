/**
 * GET    /api/tracks/[id]  — view a track
 * PATCH  /api/tracks/[id]  — update a track (admin only)
 * DELETE /api/tracks/[id]  — delete a track (admin only, blocked if it has courses)
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { updateTrackSchema } from '@/lib/validation/academic-structure'
import type { Role } from '@prisma/client'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'class_sections', 'read')) return errors.forbidden()

  const { id } = await params
  const track = await prisma.track.findUnique({
    where: { id },
    include: { courses: { select: { id: true, name: true, code: true } } },
  })
  if (!track) return errors.notFound('Track')

  return successResponse(track)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'class_sections', 'update')) return errors.forbidden()

  const { id } = await params
  const existing = await prisma.track.findUnique({ where: { id } })
  if (!existing) return errors.notFound('Track')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }

  const parsed = updateTrackSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  if (parsed.data.name && parsed.data.name !== existing.name) {
    const nameTaken = await prisma.track.findUnique({ where: { name: parsed.data.name }, select: { id: true } })
    if (nameTaken) return errors.conflict('A track with this name already exists')
  }

  const track = await prisma.$transaction(async (tx) => {
    const updated = await tx.track.update({ where: { id }, data: parsed.data })

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: 'UPDATE',
        entityType: 'Track',
        entityId: id,
        changes: parsed.data,
      },
    })

    return updated
  })

  return successResponse(track)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'class_sections', 'delete')) return errors.forbidden()

  const { id } = await params
  const existing = await prisma.track.findUnique({
    where: { id },
    include: { _count: { select: { courses: true } } },
  })
  if (!existing) return errors.notFound('Track')

  if (existing._count.courses > 0) {
    return errors.conflict('Cannot delete a track that still has courses assigned to it')
  }

  await prisma.$transaction(async (tx) => {
    await tx.track.delete({ where: { id } })
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: 'DELETE',
        entityType: 'Track',
        entityId: id,
        changes: { name: existing.name },
      },
    })
  })

  return successResponse({ id, deleted: true })
}
