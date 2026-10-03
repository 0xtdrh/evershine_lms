/**
 * GET   /api/wallet/topups/[id] — one top-up (receipt data): staff, or the student's parent / the student.
 * PATCH /api/wallet/topups/[id] { action: approve|reject, reason? } — approve a parent's uploaded receipt.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { canViewReceipt } from '@/lib/fees/receipt'
import { getFinanceSettings } from '@/lib/fees/payment-settings'
import { approveTopUp, rejectTopUp } from '@/lib/wallet/engine'
import { whatsappNumber } from '@/lib/students/portal-password'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { id } = await params
  const t = await prisma.walletTopUp.findUnique({ where: { id } })
  if (!t) return errors.notFound('Top-up')
  const allowed = checkPermission(session.user.role as Role, 'wallet', 'read') || (await canViewReceipt({ id: session.user.id, role: session.user.role }, t.studentId))
  if (!allowed) return errors.forbidden()
  const [student, company] = await Promise.all([
    prisma.student.findUnique({ where: { id: t.studentId }, select: { firstName: true, lastName: true, registrationNumber: true, guardians: { select: { firstName: true, lastName: true, phoneNumber: true }, take: 1 } } }),
    getFinanceSettings(),
  ])
  const g = student?.guardians[0]
  const name = student ? `${student.firstName} ${student.lastName}` : ''
  const text = [
    `${company.companyName} — wallet top-up receipt`,
    `${t.topUpNumber ?? 'Pending approval'}`,
    `Student: ${name} (${student?.registrationNumber ?? ''})`,
    `Amount: ${Number(t.amount)} EGP · ${t.method}`,
    t.approvedAt ? `Date: ${t.approvedAt.toLocaleString('en-GB', { timeZone: 'Africa/Cairo' })}` : '',
    'The wallet pays the invoices automatically.',
  ].filter(Boolean).join('\n')
  return successResponse({
    id: t.id, topUpNumber: t.topUpNumber, status: t.status, amount: Number(t.amount), fee: Number(t.fee), method: t.method, source: t.source,
    transactionId: t.transactionId, createdAt: t.createdAt, approvedAt: t.approvedAt, studentId: t.studentId,
    student: { name, registrationNumber: student?.registrationNumber ?? '' },
    parent: g ? { name: `${g.firstName} ${g.lastName}`.trim(), phone: g.phoneNumber } : null,
    company: { companyName: company.companyName, companyPhone: company.companyPhone, companyAddress: company.companyAddress, receiptFooter: company.receiptFooter, receiptPaper: company.receiptPaper },
    text,
    whatsappTo: g ? whatsappNumber(g.phoneNumber) : null,
  })
}

const bodySchema = z.object({ action: z.enum(['approve', 'reject']), reason: z.string().trim().max(500).optional().nullable() })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'wallet', 'approve')
  if (denied) return denied
  const { id } = await params
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const t = await prisma.walletTopUp.findUnique({ where: { id }, select: { studentId: true } })
  if (!t) return errors.notFound('Top-up')
  const s = await prisma.student.findUnique({ where: { id: t.studentId }, select: { campusId: true } })
  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && s?.campusId !== campusId) return errors.forbidden()
  const r = parsed.data.action === 'approve' ? await approveTopUp(id, session.user.id) : await rejectTopUp(id, session.user.id, parsed.data.reason)
  if ('message' in r) return r.status === 404 ? errors.notFound('Top-up') : errors.conflict(r.message)
  return successResponse(r, parsed.data.action === 'approve' ? 'Top-up approved' : 'Top-up rejected')
}
