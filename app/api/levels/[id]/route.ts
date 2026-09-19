/**
 * GET    /api/levels/[id]  — view a level
 * PATCH  /api/levels/[id]  — update a level (admin only)
 * DELETE /api/levels/[id]  — delete a level (admin only, blocked if groups use it)
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { updateLevelSchema } from '@/lib/validation/academic-structure'
import type { Role } from '@prisma/client'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'class_sections', 'read')) return errors.forbidden()

  const { id } = await params
  const level = await prisma.level.findUnique({
    where: { id },
    include: {
      subject: { select: { id: true, name: true, code: true } },
      classSections: { select: { id: true, className: true, sectionName: true, status: true } },
    },
  })
  if (!level) return errors.notFound('Level')

  return successResponse(level)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'class_sections', 'update')) return errors.forbidden()

  const { id } = await params
  const existing = await prisma.level.findUnique({ where: { id } })
  if (!existing) return errors.notFound('Level')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }

  const parsed = updateLevelSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  if (parsed.data.order && parsed.data.order !== existing.order) {
    const orderTaken = await prisma.level.findUnique({
      where: { subjectId_order: { subjectId: existing.subjectId, order: parsed.data.order } },
      select: { id: true },
    })
    if (orderTaken) return errors.conflict('This course already has a level with that order number')
  }

  const level = await prisma.$transaction(async (tx) => {
    const updated = await tx.level.update({ where: { id }, data: parsed.data })

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: 'UPDATE',
        entityType: 'Level',
        entityId: id,
        changes: parsed.data,
      },
    })

    return updated
  })

  return successResponse(level)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'class_sections', 'delete')) return errors.forbidden()

  const { id } = await params
  const existing = await prisma.level.findUnique({
    where: { id },
    include: { _count: { select: { classSections: true } } },
  })
  if (!existing) return errors.notFound('Level')

  if (existing._count.classSections > 0) {
    return errors.conflict('Cannot delete a level that still has groups assigned to it')
  }

  await prisma.$transaction(async (tx) => {
    await tx.level.delete({ where: { id } })
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: 'DELETE',
        entityType: 'Level',
        entityId: id,
        changes: { name: existing.name, subjectId: existing.subjectId },
      },
    })
  })

  return successResponse({ id, deleted: true })
}
