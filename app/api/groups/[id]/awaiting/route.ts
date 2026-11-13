/**
 * GET  /api/groups/[id]/awaiting — six phases E: students holding a seat in this group until they pay (+ their invoice).
 * POST /api/groups/[id]/awaiting { studentId, action: OPEN | REMOVE } — OPEN = joins now without paying first,
 *      REMOVE = leaves (unpaid invoice cancelled, seat freed). Permission group_entry:approve + the group's place.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { z } from 'zod'
import { errors, successResponse } from '@/lib/api-response'
import { requirePermission, requireSession } from '@/lib/academic/api-helpers'
import { prisma } from '@/lib/prisma'
import { canSeeGroup } from '@/lib/places/server'
import { openWithoutPayment, policyForGroup, removeAwaiting } from '@/lib/groups/entry'

type P = { params: Promise<{ id: string }> }

export async function GET(_r: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'group_entry', 'read')
  if (denied) return denied
  const { id } = await params
  if (!(await canSeeGroup(session.user, id))) return errors.notFound('Group')
  const rows = await prisma.studentEnrollment.findMany({ where: { classSectionId: id, status: 'AWAITING_PAYMENT' }, select: { studentId: true, student: { select: { firstName: true, lastName: true, registrationNumber: true } } } })
  const invoices = await prisma.feeInvoice.findMany({ where: { classSectionId: id, studentId: { in: rows.map((r) => r.studentId) }, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, select: { studentId: true, challanNumber: true, totalAmount: true, paidAmount: true, proofStatus: true } })
  const p = await policyForGroup(id)
  return successResponse({
    policy: { entry: p.entry, minPartPercent: p.minPartPercent },
    students: rows.map((r) => {
      const inv = invoices.find((i) => i.studentId === r.studentId)
      return { studentId: r.studentId, name: `${r.student.firstName} ${r.student.lastName}`, registrationNumber: r.student.registrationNumber, invoice: inv ? { number: inv.challanNumber, total: Number(inv.totalAmount), paid: Number(inv.paidAmount), proofStatus: inv.proofStatus } : null }
    }),
  })
}

const schema = z.object({ studentId: z.string().min(1).max(40), action: z.enum(['OPEN', 'REMOVE']) })

export async function POST(request: NextRequest, { params }: P) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'group_entry', 'approve')
  if (denied) return denied
  const { id } = await params
  if (!(await canSeeGroup(session.user, id))) return errors.notFound('Group')
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const ok = parsed.data.action === 'OPEN' ? await openWithoutPayment(id, parsed.data.studentId, session.user.id) : await removeAwaiting(id, parsed.data.studentId)
  return ok ? successResponse({ ok: true }) : errors.notFound('Waiting student')
}
