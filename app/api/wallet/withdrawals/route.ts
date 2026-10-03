/**
 * Wallet withdrawals (phase B).
 * GET  /api/wallet/withdrawals?status=PENDING|ALL
 * POST /api/wallet/withdrawals { studentId, amount, payoutMethod, reason? } — staff ask on the parent's behalf
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { requestWithdrawal } from '@/lib/wallet/engine'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'wallet', 'read')
  if (denied) return denied
  const campusId = campusScope(role, session.user.campusId, null)
  const status = new URL(request.url).searchParams.get('status') ?? 'PENDING'
  const rows = await prisma.walletWithdrawal.findMany({ where: status === 'ALL' ? {} : { status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 200 })
  const students = await prisma.student.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.studentId))] }, ...(campusId && { campusId }) },
    select: { id: true, firstName: true, lastName: true, registrationNumber: true },
  })
  const S = new Map(students.map((s) => [s.id, s]))
  return successResponse(rows.filter((r) => S.has(r.studentId)).map((r) => {
    const s = S.get(r.studentId)!
    return {
      id: r.id, withdrawalNumber: r.withdrawalNumber, amount: Number(r.amount), fee: Number(r.fee), payoutMethod: r.payoutMethod, reason: r.reason,
      status: r.status, requestedVia: r.requestedVia, createdAt: r.createdAt, approvedAt: r.approvedAt, rejectedReason: r.rejectedReason,
      student: { id: s.id, name: `${s.firstName} ${s.lastName}`, registrationNumber: s.registrationNumber },
    }
  }))
}

const bodySchema = z.object({
  studentId: z.string().min(1),
  amount: z.number().positive(),
  payoutMethod: z.string().min(1).max(50),
  reason: z.string().trim().max(500).optional().nullable(),
})

export async function POST(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'wallet', 'create')
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data
  const s = await prisma.student.findUnique({ where: { id: d.studentId! }, select: { campusId: true } })
  if (!s) return errors.notFound('Student')
  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && s.campusId !== campusId) return errors.forbidden()
  const r = await requestWithdrawal({ studentId: d.studentId!, amount: d.amount!, payoutMethod: d.payoutMethod!, reason: d.reason ?? null, via: 'STAFF', userId: session.user.id })
  if ('message' in r) return r.status === 403 ? errors.forbidden(r.message) : errors.badRequest(r.message)
  return createdResponse(r, 'Withdrawal requested — waiting for approval')
}
