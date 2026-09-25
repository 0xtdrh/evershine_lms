/**
 * POST /api/groups/[id]/generate-invoices
 * Body: { studentId?: string }
 * Generates the group's CURRENT cycle invoice for every active student
 * missing one, or just one student if studentId is given (used right after
 * adding them to the group). Already-billed students are skipped — safe to
 * call repeatedly.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { generateMissingCycleInvoices } from '@/lib/groups/generate-invoices'
import type { Role } from '@prisma/client'

const bodySchema = z.object({ studentId: z.string().min(1).optional() })

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'fees', 'create')
  if (denied) return denied

  const { id } = await params
  const group = await prisma.classSection.findUnique({ where: { id }, select: { campusId: true } })
  if (!group) return errors.notFound('Group')

  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && group.campusId !== campusId) return errors.forbidden()

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    // no body — fine, generates for everyone missing one
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)

  const result = await generateMissingCycleInvoices(id, session.user.id, parsed.data.studentId)

  return successResponse(result)
}
