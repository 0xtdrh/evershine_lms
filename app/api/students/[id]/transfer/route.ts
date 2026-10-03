/**
 * Move a student to another group (docs/design-student-transfer.md).
 *
 * GET  /api/students/[id]/transfer?from=<groupId>&to=<groupId>  -> preview (money + discounts to decide)
 * GET  /api/students/[id]/transfer                              -> this student's transfer history
 * POST /api/students/[id]/transfer  { fromClassSectionId, toClassSectionId, creditTo, discountDecisions, reason? }
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { executeTransfer, listTransfers, previewTransfer, type ExecuteTransferInput } from '@/lib/groups/transfer'

async function outsideCampus(role: Role, userCampusId: string | null | undefined, groupIds: string[]) {
  const campusId = campusScope(role, userCampusId, null)
  if (!campusId) return false
  const n = await prisma.classSection.count({ where: { id: { in: groupIds }, campusId } })
  return n !== new Set(groupIds).size
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'group_transfers', 'read')
  if (denied) return denied
  const { id } = await params

  const sp = new URL(request.url).searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  if (!from || !to) return successResponse(await listTransfers(id))

  if (await outsideCampus(role, session.user.campusId, [from, to])) return errors.forbidden('That group is in another branch')
  const r = await previewTransfer(id, from, to)
  if ('message' in r) return errorFor(r.status, r.message)
  return successResponse(r.preview)
}

const bodySchema = z.object({
  fromClassSectionId: z.string().min(1),
  toClassSectionId: z.string().min(1),
  creditTo: z.enum(['NEW_INVOICE', 'WALLET']),
  discountDecisions: z.array(z.object({ assignmentId: z.string().min(1), action: z.enum(['MOVE', 'KEEP', 'END']) })).default([]),
  reason: z.string().trim().max(500).optional().nullable(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'group_transfers', 'create')
  if (denied) return denied
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.validation({ errors: [{ path: [], message: 'Invalid JSON' }] } as never)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data

  if (await outsideCampus(role, session.user.campusId, [d.fromClassSectionId, d.toClassSectionId])) {
    return errors.forbidden('That group is in another branch')
  }
  const r = await executeTransfer({ ...(d as Omit<ExecuteTransferInput, 'studentId' | 'userId'>), studentId: id, userId: session.user.id })
  if ('message' in r) return errorFor(r.status, r.message)
  return createdResponse(r, 'Student moved to the new group')
}

function errorFor(status: number, message: string) {
  if (status === 404) return errors.notFound(message.replace(/ not found$/, ''))
  if (status === 403) return errors.forbidden(message)
  if (status === 409) return errors.conflict(message)
  return errors.badRequest(message)
}
