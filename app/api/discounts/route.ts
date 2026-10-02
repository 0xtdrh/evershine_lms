/**
 * GET  /api/discounts?status=&studentId=&classSectionId= — discounts given
 * POST /api/discounts — give a discount to a student or a whole group
 *
 * Who may give it depends on the type's approvalMode (docs/design-discounts.md):
 *  STAFF               -> discounts:create, active at once
 *  MANAGER             -> discount_approvals:approve only
 *  STAFF_WITH_APPROVAL -> discounts:create; PENDING until a manager approves
 *                         (managers' own requests are active at once)
 * When it is active, the response lists the student's unpaid invoices it could
 * also apply to, so the screen can ASK (owner's choice) before changing them.
 */

import { NextRequest } from 'next/server'
import type { Prisma, Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { createdResponse, errors, successResponse } from '@/lib/api-response'
import { logAudit } from '@/lib/audit-logger'
import { discountAssignmentSchema } from '@/lib/validation/discounts'
import {
  canApproveDiscounts,
  groupContext,
  invoicesAffectedBy,
  notifyApprovers,
  typeIsValidNow,
  typeMatchesScope,
} from '@/lib/discounts/engine'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'discounts', 'read') && !checkPermission(role, 'discount_approvals', 'read')) return errors.forbidden()

  const sp = new URL(request.url).searchParams
  const where: Prisma.DiscountAssignmentWhereInput = {}
  const status = sp.get('status')
  if (status && ['PENDING', 'ACTIVE', 'REJECTED', 'ENDED'].includes(status)) where.status = status
  if (sp.get('studentId')) where.studentId = sp.get('studentId')
  if (sp.get('classSectionId')) where.classSectionId = sp.get('classSectionId')

  const rows = await prisma.discountAssignment.findMany({
    where,
    include: { discountType: { select: { id: true, name: true, kind: true, valueType: true, duration: true, approvalMode: true } } },
    orderBy: { createdAt: 'desc' },
    take: 300,
  })
  // Names for students, groups, tracks and staff (one query each).
  const ids = (k: 'studentId' | 'classSectionId' | 'trackId') => [...new Set(rows.map((r) => r[k]).filter(Boolean))] as string[]
  const userIds = [...new Set(rows.flatMap((r) => [r.requestedById, r.approvedById, r.endedById]).filter(Boolean))] as string[]
  const [students, groups, tracks, users] = await Promise.all([
    prisma.student.findMany({ where: { id: { in: ids('studentId') } }, select: { id: true, firstName: true, lastName: true, registrationNumber: true } }),
    prisma.classSection.findMany({ where: { id: { in: ids('classSectionId') } }, select: { id: true, className: true, sectionName: true } }),
    prisma.track.findMany({ where: { id: { in: ids('trackId') } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, displayName: true } }),
  ])
  const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]))
  const S = byId(students), G = byId(groups), T = byId(tracks), U = byId(users)
  const who = (id: string | null) => (id ? U.get(id)?.displayName || U.get(id)?.email || null : null)
  return successResponse(
    rows.map((r) => ({
      ...r,
      value: Number(r.value),
      student: r.studentId ? S.get(r.studentId) ?? null : null,
      group: r.classSectionId && G.get(r.classSectionId)
        ? { id: r.classSectionId, name: `${G.get(r.classSectionId)!.className} ${G.get(r.classSectionId)!.sectionName}`.trim() }
        : null,
      track: r.trackId ? T.get(r.trackId) ?? null : null,
      requestedBy: who(r.requestedById),
      approvedBy: who(r.approvedById),
    }))
  )
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  const canGive = checkPermission(role, 'discounts', 'create')
  const canApprove = canApproveDiscounts(role)
  if (!canGive && !canApprove) return errors.forbidden()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Invalid JSON')
  }
  const parsed = discountAssignmentSchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data

  const type = await prisma.discountType.findUnique({ where: { id: d.discountTypeId! } })
  if (!type) return errors.notFound('Discount type')
  if (!typeIsValidNow(type)) return errors.badRequest('This discount type is switched off or outside its dates')
  if (type.autoApply) return errors.badRequest('This discount is applied automatically; there is no need to give it by hand')

  // Who may give it
  if (type.approvalMode === 'MANAGER' && !canApprove) return errors.forbidden('Only a manager can give this discount')
  if (type.approvalMode !== 'MANAGER' && !canGive && !canApprove) return errors.forbidden()
  const status = type.approvalMode === 'STAFF_WITH_APPROVAL' && !canApprove ? 'PENDING' : 'ACTIVE'

  // Value
  let value = Number(type.value)
  if (type.editableValue && d.value != null) {
    const max = type.maxValue != null ? Number(type.maxValue) : type.valueType === 'PERCENT' ? 100 : Infinity
    if (d.value > max) return errors.badRequest(`The maximum for this discount is ${max}${type.valueType === 'PERCENT' ? '%' : ' EGP'}`)
    value = d.value
  }
  if (type.valueType === 'PERCENT' && value > 100) return errors.badRequest('A percentage cannot be more than 100')

  // Target checks
  if (d.studentId) {
    const student = await prisma.student.findUnique({ where: { id: d.studentId }, select: { id: true } })
    if (!student) return errors.notFound('Student')
  }
  if (d.classSectionId) {
    const group = await prisma.classSection.findUnique({ where: { id: d.classSectionId }, select: { id: true, status: true } })
    if (!group) return errors.notFound('Group')
    if (group.status === 'COMPLETED') return errors.badRequest('This group is finished')
    if (d.studentId) {
      const enrolled = await prisma.studentEnrollment.findFirst({ where: { studentId: d.studentId, classSectionId: d.classSectionId, status: 'ACTIVE' } })
      if (!enrolled) return errors.badRequest('The student is not in this group')
    }
    if (!typeMatchesScope(type, await groupContext(prisma, d.classSectionId))) {
      return errors.badRequest('This discount type does not apply to that group')
    }
  }
  if (d.trackId) {
    const track = await prisma.track.findUnique({ where: { id: d.trackId }, select: { id: true } })
    if (!track) return errors.notFound('Track')
  }

  const assignment = await prisma.discountAssignment.create({
    data: {
      discountTypeId: type.id,
      studentId: d.studentId ?? null,
      classSectionId: d.classSectionId ?? null,
      trackId: d.trackId ?? null,
      value,
      status,
      reason: d.reason ?? null,
      requestedById: session.user.id,
      ...(status === 'ACTIVE' && { approvedById: session.user.id, approvedAt: new Date() }),
    },
  })

  try {
    await logAudit({
      prismaClient: prisma,
      userId: session.user.id,
      action: 'CREATE',
      entityType: 'DiscountAssignment',
      entityId: assignment.id,
      changes: { type: type.name, value, status, studentId: d.studentId, classSectionId: d.classSectionId, trackId: d.trackId, reason: d.reason },
      request,
    })
  } catch (err) {
    console.error('[DISCOUNT_AUDIT]', err)
  }

  if (status === 'PENDING') {
    await notifyApprovers('Discount request', `${type.name} (${value}${type.valueType === 'PERCENT' ? '%' : ' EGP'}) waiting for approval`, assignment.id)
    return createdResponse({ assignment, affectedInvoices: [] }, 'Sent for approval')
  }
  const affectedInvoices = await invoicesAffectedBy(assignment)
  return createdResponse({ assignment, affectedInvoices }, 'Discount added')
}
