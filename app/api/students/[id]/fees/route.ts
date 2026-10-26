/**
 * GET /api/students/[id]/fees — FIN-2: the extra fees charged to a student (and whether each is paid).
 * POST { feeTypeId, amount? } — staff add a fee to this student (its own invoice; the wallet pays it if it can).
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { createdResponse, successResponse } from '@/lib/api-response'
import { canSeeStudent } from '@/lib/places/server'
import { addFee, FeeError } from '@/lib/fees-extra/engine'
import { withMonthLock } from '@/lib/month-close/with-lock'

export const dynamic = 'force-dynamic'
const schema = z.object({ feeTypeId: z.string().min(1), amount: z.number().min(0).max(1000000).optional().nullable() })

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  if (!checkPermission(session.user.role, 'fees', 'read') || !(await canSeeStudent(session.user, id))) return errors.forbidden()
  const charges = await prisma.studentFeeCharge.findMany({ where: { studentId: id }, orderBy: { createdAt: 'desc' } })
  const [types, invoices] = await Promise.all([
    prisma.feeType.findMany({ where: { id: { in: charges.map((c) => c.feeTypeId) } }, select: { id: true, nameEn: true, nameAr: true } }),
    prisma.feeInvoice.findMany({ where: { id: { in: charges.map((c) => c.invoiceId) } }, select: { id: true, challanNumber: true, status: true } }),
  ])
  return successResponse(charges.map((c) => ({ ...c, amount: Number(c.amount), fee: types.find((t) => t.id === c.feeTypeId) ?? null, invoice: invoices.find((i) => i.id === c.invoiceId) ?? null })))
}

async function POST_(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  const { id } = await params
  if (!role || !checkPermission(role, 'fees', 'create') || !(await canSeeStudent(session.user, id))) return errors.forbidden()
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errors.validation(parsed.error)
  const d = parsed.data as { feeTypeId: string; amount?: number | null }
  try { return createdResponse({ invoiceId: await addFee(session.user, id, d.feeTypeId, d.amount) }) } catch (e) {
    if (e instanceof FeeError) return errors.badRequest(e.message)
    throw e
  }
}

// a03: a write into a closed month answers 409 with the reason
export const POST = withMonthLock(POST_)
