/**
 * Partners part 1-B2: GET /api/partners/export?kind=partners|statements|balances — branded Excel (TechNova logo + colours).
 * partners: RBAC partners:read; statements / balances: partner_finance:export.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { Role } from '@prisma/client'
import { errors } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { createBrandedWorkbook } from '@/lib/excel/report-generator'
import { listPartners } from '@/lib/partners/engine'
import { openBalances } from '@/lib/partners/statement-engine'
import { remaining } from '@/lib/partners/statement'

const d10 = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '')

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const kind = new URL(request.url).searchParams.get('kind') ?? 'partners'
  let wb
  if (kind === 'partners') {
    if (!checkPermission(role, 'partners', 'read')) return errors.forbidden()
    const rows = await listPartners()
    wb = await createBrandedWorkbook({
      title: 'Partners', sheetName: 'Partners',
      columns: [
        { header: 'Partner', key: 'name', width: 30 }, { header: 'Type', key: 'kind', width: 14 }, { header: 'Contact', key: 'contact', width: 22 },
        { header: 'Phone', key: 'phone', width: 16, forceText: true }, { header: 'Places', key: 'places', width: 8 }, { header: 'Active groups', key: 'groups', width: 12 },
        { header: 'Contract', key: 'contract', width: 26 }, { header: 'Contract ends', key: 'ends', width: 14 }, { header: 'Status', key: 'status', width: 12 },
      ],
      rows: rows.map((p) => ({ name: p.name, kind: p.kind, contact: p.contactName ?? '', phone: p.contactPhone ?? '', places: p.places, groups: p.activeGroups, contract: p.contract?.title ?? '', ends: d10(p.contract?.endDate ?? null), status: p.isActive ? 'ACTIVE' : 'STOPPED' })),
    })
  } else if (kind === 'statements' || kind === 'balances') {
    if (!checkPermission(role, 'partner_finance', 'export')) return errors.forbidden()
    if (kind === 'statements') {
      const rows = await prisma.partnerStatement.findMany({ orderBy: [{ periodFrom: 'desc' }], include: { payments: true, partner: { select: { name: true } } } })
      wb = await createBrandedWorkbook({
        title: 'Partner statements', subtitle: 'Amounts from TechNova’s side: + the partner owes TechNova, − TechNova owes the partner', sheetName: 'Statements', statusColumn: 'status',
        columns: [
          { header: 'Number', key: 'number', width: 20 }, { header: 'Partner', key: 'partner', width: 28 }, { header: 'From', key: 'from', width: 12 }, { header: 'To', key: 'to', width: 12 },
          { header: 'Status', key: 'status', width: 12 }, { header: 'This period', key: 'period', width: 14 }, { header: 'Carried in', key: 'previous', width: 12 },
          { header: 'Total', key: 'total', width: 14 }, { header: 'Left', key: 'left', width: 14 },
        ],
        rows: rows.map((s) => ({
          number: s.number, partner: s.partner.name, from: d10(s.periodFrom), to: d10(s.periodTo), status: s.status, period: Number(s.periodBalance), previous: Number(s.previousBalance),
          total: Number(s.totalDue), left: remaining(Number(s.totalDue), s.payments.map((p) => ({ direction: p.direction as 'PARTNER_TO_TECHNOVA', amount: Number(p.amount) }))),
        })),
      })
    } else {
      const rows = await openBalances()
      wb = await createBrandedWorkbook({
        title: 'Partner balances', subtitle: 'What is still open on approved statements', sheetName: 'Balances',
        columns: [{ header: 'Partner', key: 'name', width: 30 }, { header: 'The partner owes TechNova', key: 'receive', width: 22 }, { header: 'TechNova owes the partner', key: 'pay', width: 22 }],
        rows: rows.map((b) => ({ name: b.name, receive: b.rest > 0 ? b.rest : 0, pay: b.rest < 0 ? Math.abs(b.rest) : 0 })),
      })
    }
  } else {
    return errors.badRequest('Unknown export')
  }
  const buf = await wb.xlsx.writeBuffer()
  return new NextResponse(Buffer.from(buf as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="technova-${kind}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  })
}
