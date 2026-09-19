/**
 * GET  /api/levels?subjectId=xxx  — list levels (optionally filtered by course)
 * POST /api/levels                — create a level for a course (admin only)
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, createdResponse, successResponse } from '@/lib/api-response'
import { createLevelSchema } from '@/lib/validation/academic-structure'
import type { Role } from '@prisma/client'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'class_sections', 'read')) return errors.forbidden()

  const { searchParams } = new URL(request.url)
  const subjectId = searchParams.get('subjectId')

  const levels = await prisma.level.findMany({
    where: { ...(subjectId && { subjectId }) },
    orderBy: [{ subjectId: 'asc' }, { order: 'asc' }],
    include: {
      subject: { select: { id: true, name: true, code: true } },
      _count: { select: { classSections: true } },
    },
  })

  return successResponse(levels)
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

  const parsed = createLevelSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const subject = await prisma.academicSubject.findUnique({ where: { id: parsed.data.subjectId }, select: { id: true } })
  if (!subject) return errors.notFound('Course')

  const orderTaken = await prisma.level.findUnique({
    where: { subjectId_order: { subjectId: parsed.data.subjectId, order: parsed.data.order } },
    select: { id: true },
  })
  if (orderTaken) return errors.conflict('This course already has a level with that order number')

  const level = await prisma.$transaction(async (tx) => {
    const newLevel = await tx.level.create({ data: parsed.data })

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: 'CREATE',
        entityType: 'Level',
        entityId: newLevel.id,
        changes: parsed.data,
      },
    })

    return newLevel
  })

  return createdResponse(level, 'Level created successfully')
}
