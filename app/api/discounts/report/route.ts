/**
 * GET /api/discounts/report?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Discounts given on invoices issued in the period: total, by type, by group,
 * by the staff member who gave it (auto discounts show as "Automatic").
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = session.user.role as Role
  if (!checkPermission(role, 'discounts', 'read') && !checkPermission(role, 'financial_reports', 'read')) return errors.forbidden()

  const sp = new URL(request.url).searchParams
  const now = new Date()
  const from = sp.get('from') ? new Date(`${sp.get('from')}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), 1)
  const to = sp.get('to') ? new Date(`${sp.get('to')}T23:59:59.999`) : now
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return errors.badRequest('Invalid dates')

  const lines = await prisma.invoiceDiscount.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { amount: true, label: true, discountTypeId: true, invoiceId: true, assignment: { select: { requestedById: true } } },
  })
  const invoices = await prisma.feeInvoice.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.invoiceId))] } },
    select: { id: true, status: true, classSection: { select: { id: true, className: true, sectionName: true } } },
  })
  const inv = new Map(invoices.map((i) => [i.id, i]))
  const staffIds = [...new Set(lines.map((l) => l.assignment?.requestedById).filter(Boolean))] as string[]
  const staff = new Map(
    (await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, email: true, displayName: true } })).map((u) => [u.id, u.displayName || u.email])
  )

  const add = (m: Map<string, { name: string; amount: number; count: number }>, key: string, name: string, amount: number) => {
    const cur = m.get(key) ?? { name, amount: 0, count: 0 }
    cur.amount = Math.round((cur.amount + amount) * 100) / 100
    cur.count += 1
    m.set(key, cur)
  }
  const byType = new Map<string, { name: string; amount: number; count: number }>()
  const byGroup = new Map<string, { name: string; amount: number; count: number }>()
  const byStaff = new Map<string, { name: string; amount: number; count: number }>()
  let total = 0
  for (const l of lines) {
    const i = inv.get(l.invoiceId)
    if (!i || i.status === 'CANCELLED') continue
    const amount = Number(l.amount)
    total += amount
    add(byType, l.discountTypeId, l.label, amount)
    const g = i.classSection
    add(byGroup, g?.id ?? 'none', g ? `${g.className} ${g.sectionName}`.trim() : 'Other invoices', amount)
    const sid = l.assignment?.requestedById
    add(byStaff, sid ?? 'auto', sid ? staff.get(sid) ?? 'Unknown' : 'Automatic', amount)
  }
  const list = (m: Map<string, { name: string; amount: number; count: number }>) => [...m.values()].sort((a, b) => b.amount - a.amount)
  return successResponse({
    from: from.toISOString(),
    to: to.toISOString(),
    total: Math.round(total * 100) / 100,
    byType: list(byType),
    byGroup: list(byGroup),
    byStaff: list(byStaff),
  })
}
