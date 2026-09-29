/**
 * PATCH /api/guardians/[id]/phone
 * Body: { phoneNumber }
 *
 * Changes a parent's phone number; their login number follows it
 * (lib/students/guardian-phone.ts). Staff with students:update only, and a
 * branch-scoped user only for parents of students in their branch.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, errorResponse, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { changeGuardianPhone } from '@/lib/students/guardian-phone'
import type { Role } from '@prisma/client'

const bodySchema = z.object({ phoneNumber: z.string().trim().min(8).max(20) })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'students', 'update')
  if (denied) return denied

  const { id } = await params
  const scoped = campusScope(role, session.user.campusId, null)
  const guardian = await prisma.guardian.findUnique({
    where: { id },
    select: { id: true, students: { select: { campusId: true } } },
  })
  if (!guardian) return errors.notFound('Parent')
  if (scoped && !guardian.students.some((s) => s.campusId === scoped)) return errors.forbidden()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const result = await changeGuardianPhone(id, parsed.data.phoneNumber, session.user.id)
  if ('message' in result) {
    return errorResponse(result.reason, result.message, result.reason === 'TAKEN' ? 409 : result.reason === 'NOT_FOUND' ? 404 : 400)
  }
  return successResponse(result, { message: result.changed ? 'Phone updated — the parent now signs in with the new number' : 'No change' })
}
