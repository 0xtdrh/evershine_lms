/**
 * GET  /api/tracks  — list tracks
 * POST /api/tracks  — create a track (admin only)
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, createdResponse, successResponse } from '@/lib/api-response'
import { createTrackSchema } from '@/lib/validation/academic-structure'
import type { Role } from '@prisma/client'

export async function GET(_request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'class_sections', 'read')) return errors.forbidden()

  const tracks = await prisma.track.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { courses: true } } },
  })

  return successResponse(tracks)
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'class_sections', 'create')) return errors.forbidden()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }

  const parsed = createTrackSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const existing = await prisma.track.findUnique({ where: { name: parsed.data.name }, select: { id: true } })
  if (existing) return errors.conflict('A track with this name already exists')

  const track = await prisma.$transaction(async (tx) => {
    const newTrack = await tx.track.create({ data: parsed.data })

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: 'CREATE',
        entityType: 'Track',
        entityId: newTrack.id,
        changes: parsed.data,
      },
    })

    return newTrack
  })

  return createdResponse(track, 'Track created successfully')
}
