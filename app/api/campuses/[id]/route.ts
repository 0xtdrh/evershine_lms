/**
 * GET    /api/campuses/[id]  — fetch single campus
 * PATCH  /api/campuses/[id]  — partial update
 * DELETE /api/campuses/[id]  — soft delete
 */

import { allowsCampus } from '@/lib/places/rules'
import { loadPlaces } from '@/lib/places/server'
import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse, errorResponse } from '@/lib/api-response'
import { updateCampusSchema } from '@/lib/validation/batch'
import type { Role } from '@prisma/client'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'campuses', 'read')) return errors.forbidden()

  const { id } = await params

  if (!allowsCampus(await loadPlaces(session.user), id)) {
    return errors.forbidden()
  }

  const campus = await prisma.campus.findUnique({
    where: { id },
    include: {
      batches: { where: { isActive: true } },
    },
  })

  if (!campus) return errors.notFound('Campus')

  return successResponse(campus)
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'campuses', 'update')) return errors.forbidden()

  const { id } = await params

  if (!allowsCampus(await loadPlaces(session.user), id)) {
    return errors.forbidden()
  }

  const existing = await prisma.campus.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return errors.notFound('Campus')

  let body: unknown
  try { body = await request.json() } catch { return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never) }

  const parsed = updateCampusSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const updated = await prisma.$transaction(async (tx) => {
    const campus = await tx.campus.update({
      where: { id },
      data: parsed.data,
    })

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: 'UPDATE',
        entityType: 'Campus',
        entityId: id,
        changes: parsed.data,
      },
    })

    return campus
  })

  return successResponse(updated, 'Campus updated successfully')
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  if (!checkPermission(session.user.role as Role, 'campuses', 'delete')) return errors.forbidden()

  const { id } = await params

  if (session.user.role !== 'SUPER_ADMIN') {
    return errors.forbidden()
  }

  const existing = await prisma.campus.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!existing) return errors.notFound('Campus')

  // final test X12: closing a branch must not leave running groups and their students behind (nothing is lost: it is refused)
  const [groups, students] = await Promise.all([
    prisma.classSection.count({ where: { campusId: id, status: 'ACTIVE', isActive: true } }),
    prisma.studentEnrollment.count({ where: { status: { in: ['ACTIVE', 'AWAITING_PAYMENT'] }, classSection: { campusId: id, status: 'ACTIVE', isActive: true } } }),
  ])
  if (groups > 0 || students > 0) {
    return errorResponse('CAMPUS_HAS_GROUPS', `${existing.name} still has ${groups} running group(s) with ${students} student(s). Move them to another branch (or finish the groups) first. · الفرع لسه فيه ${groups} جروب شغال و${students} طالب. انقلهم لفرع تاني (أو اقفل الجروبات) الأول.`, 409)
  }

  await prisma.$transaction(async (tx) => {
    await tx.campus.update({
      where: { id },
      data: { isActive: false },
    })

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: 'DELETE',
        entityType: 'Campus',
        entityId: id,
      },
    })
  })

  return successResponse({ id }, 'Campus deactivated successfully')
}
