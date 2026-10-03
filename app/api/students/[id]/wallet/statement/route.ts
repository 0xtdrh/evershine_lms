/**
 * GET /api/students/[id]/wallet/statement?from=YYYY-MM-DD&to=YYYY-MM-DD — account statement
 * (opening balance, every movement with its document number, closing balance). Phase B.
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { canViewReceipt } from '@/lib/fees/receipt'
import { getFinanceSettings } from '@/lib/fees/payment-settings'

const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const { id } = await params
  const role = session.user.role as Role
  const allowed = checkPermission(role, 'wallet', 'read') || checkPermission(role, 'refunds', 'read') || (await canViewReceipt({ id: session.user.id, role: session.user.role }, id))
  if (!allowed) return errors.forbidden()
  const student = await prisma.student.findUnique({ where: { id }, select: { firstName: true, lastName: true, registrationNumber: true, walletVisibleToStudent: true, campus: { select: { name: true } } } })
  if (!student) return errors.notFound('Student')
  if (role === 'STUDENT' && !student.walletVisibleToStudent) return errors.forbidden()

  const sp = new URL(request.url).searchParams
  const today = new Date().toISOString().slice(0, 10)
  const from = sp.get('from') && DATE.test(sp.get('from')!) ? sp.get('from')! : `${today.slice(0, 8)}01`
  const to = sp.get('to') && DATE.test(sp.get('to')!) ? sp.get('to')! : today
  const start = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000)

  const [opening, rows, company] = await Promise.all([
    prisma.walletTransaction.aggregate({ where: { studentId: id, createdAt: { lt: start } }, _sum: { amount: true } }),
    prisma.walletTransaction.findMany({ where: { studentId: id, createdAt: { gte: start, lt: end } }, orderBy: { createdAt: 'asc' } }),
    getFinanceSettings(),
  ])
  const topUps = await prisma.walletTopUp.findMany({ where: { id: { in: rows.map((r) => r.topUpId).filter((x): x is string => !!x) } }, select: { id: true, topUpNumber: true, method: true } })
  const pays = await prisma.feePayment.findMany({ where: { id: { in: rows.map((r) => r.paymentId).filter((x): x is string => !!x) } }, select: { id: true, receiptNumber: true, invoice: { select: { challanNumber: true, month: true } } } })
  const T = new Map(topUps.map((t) => [t.id, t]))
  const P = new Map(pays.map((p) => [p.id, p]))
  let running = Number(opening._sum.amount ?? 0)
  const lines = rows.map((r) => {
    running = Math.round((running + Number(r.amount)) * 100) / 100
    const t = r.topUpId ? T.get(r.topUpId) : null
    const p = r.paymentId ? P.get(r.paymentId) : null
    return {
      date: r.createdAt,
      type: r.type,
      amount: Number(r.amount),
      balance: running,
      document: r.type === 'PAYMENT' ? p?.receiptNumber ?? null : t?.topUpNumber ?? null,
      detail: r.type === 'PAYMENT' && p ? `${p.invoice.challanNumber} · ${p.invoice.month}` : r.type === 'TOPUP' && t ? t.method : r.note,
    }
  })
  return successResponse({
    company: { companyName: company.companyName, companyPhone: company.companyPhone, companyAddress: company.companyAddress },
    student: { name: `${student.firstName} ${student.lastName}`, registrationNumber: student.registrationNumber, campus: student.campus.name },
    from, to,
    opening: Math.round(Number(opening._sum.amount ?? 0) * 100) / 100,
    closing: running,
    totals: {
      in: Math.round(lines.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0) * 100) / 100,
      out: Math.round(lines.filter((l) => l.amount < 0).reduce((a, l) => a - l.amount, 0) * 100) / 100,
    },
    lines,
  })
}
