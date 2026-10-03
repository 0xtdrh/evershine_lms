/**
 * Wallet top-ups (phase B, docs/design-phase-b.md).
 * GET  /api/wallet/topups?status=PENDING|TODAY  — receipts to approve / today's top-ups, + prepaid total
 * POST /api/wallet/topups { studentId, amount, method, transactionId?, remarks? } — staff top-up at the branch
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse, createdResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { isActivePaymentMethod } from '@/lib/fees/payment-settings'
import { prepaidTotal, staffTopUp } from '@/lib/wallet/engine'

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'wallet', 'read')
  if (denied) return denied
  const campusId = campusScope(role, session.user.campusId, null)
  const status = new URL(request.url).searchParams.get('status') ?? 'PENDING'
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const rows = await prisma.walletTopUp.findMany({
    where: status === 'TODAY' ? { status: 'APPROVED', source: { not: 'PAYMENT' }, approvedAt: { gte: start } } : { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  const students = await prisma.student.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.studentId))] }, ...(campusId && { campusId }) },
    select: { id: true, firstName: true, lastName: true, registrationNumber: true },
  })
  const S = new Map(students.map((s) => [s.id, s]))
  return successResponse({
    prepaidTotal: await prepaidTotal(campusId),
    topUps: rows.filter((r) => S.has(r.studentId)).map((r) => {
      const s = S.get(r.studentId)!
      return {
        id: r.id, topUpNumber: r.topUpNumber, amount: Number(r.amount), fee: Number(r.fee), method: r.method, source: r.source, status: r.status,
        proofUrl: r.proofUrl, remarks: r.remarks, transactionId: r.transactionId, createdAt: r.createdAt, approvedAt: r.approvedAt,
        student: { id: s.id, name: `${s.firstName} ${s.lastName}`, registrationNumber: s.registrationNumber },
      }
    }),
  })
}

const bodySchema = z.object({
  studentId: z.string().min(1),
  amount: z.number().positive(),
  method: z.string().min(1).max(50),
  transactionId: z.string().trim().max(100).optional().nullable(),
  remarks: z.string().trim().max(500).optional().nullable(),
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
  if (!(await isActivePaymentMethod(d.method))) return errors.badRequest('Unknown payment method. Choose one from the list.')
  const student = await prisma.student.findUnique({ where: { id: d.studentId }, select: { campusId: true } })
  if (!student) return errors.notFound('Student')
  const campusId = campusScope(role, session.user.campusId, null)
  if (campusId && student.campusId !== campusId) return errors.forbidden('This student is in another branch')
  const r = await staffTopUp({ studentId: d.studentId!, amount: d.amount!, method: d.method!, transactionId: d.transactionId ?? null, remarks: d.remarks ?? null, userId: session.user.id })
  if ('message' in r) return r.status === 404 ? errors.notFound('Student') : errors.badRequest(r.message)
  return createdResponse(r, `Wallet topped up (${r.topUpNumber})`)
}
