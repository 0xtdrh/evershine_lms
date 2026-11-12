/** GET /api/enrolment-codes/[batch] (?format=xlsx) — the codes of a batch and who used them (discounts:read / export).
 *  PATCH { active } — stop / start the whole batch (discounts:update). */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { batchCodes, setBatchActive } from '@/lib/site/codes-store'
import { createBrandedWorkbook } from '@/lib/excel/report-generator'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ batch: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'discounts', 'read')) return errors.forbidden()
  const { batch } = await params
  const codes = await batchCodes(decodeURIComponent(batch))
  const uses = await prisma.enrolmentCodeUse.findMany({ where: { codeId: { in: codes.map((c) => c.id) } }, orderBy: { createdAt: 'desc' } })
  const rows = codes.map((c) => ({ code: c.code, kind: c.kind, value: c.value, uses: c.uses, maxUses: c.maxUses, active: c.isActive, expiresAt: c.expiresAt, usedBy: uses.filter((u) => u.codeId === c.id).map((u) => ({ phone: u.phone, at: u.createdAt })) }))
  if (request.nextUrl.searchParams.get('format') !== 'xlsx') return successResponse(rows)
  if (!checkPermission(role, 'discounts', 'read')) return errors.forbidden()
  const wb = await createBrandedWorkbook({
    title: `Enrolment codes ${decodeURIComponent(batch)}`, subtitle: `${rows.length} codes`, sheetName: 'Codes',
    columns: [{ header: 'Code', key: 'code', width: 18 }, { header: 'Kind', key: 'kind', width: 10 }, { header: 'Value', key: 'value', width: 10 }, { header: 'Used', key: 'uses', width: 8 }, { header: 'Max uses', key: 'maxUses', width: 10 }, { header: 'Active', key: 'active', width: 8 }, { header: 'Ends', key: 'ends', width: 12 }],
    rows: rows.map((r) => ({ ...r, maxUses: r.maxUses ?? '∞', active: r.active ? 'yes' : 'no', ends: r.expiresAt ? r.expiresAt.toISOString().slice(0, 10) : '' })) as unknown as Record<string, string | number>[],
  })
  const buf = await wb.xlsx.writeBuffer()
  return new NextResponse(Buffer.from(buf as ArrayBuffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="codes-${encodeURIComponent(batch)}.xlsx"` } })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ batch: string }> }) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'discounts', 'update')) return errors.forbidden()
  const { batch } = await params
  const body = (await request.json().catch(() => null)) as { active?: boolean } | null
  if (typeof body?.active !== 'boolean') return errors.badRequest('active is required')
  const r = await setBatchActive(decodeURIComponent(batch), body.active)
  return successResponse({ changed: r.count })
}
