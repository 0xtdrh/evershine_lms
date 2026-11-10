/**
 * GET /api/business-growth?months=12&campusId=(&format=xlsx) — p14: the company's numbers month by month.
 * RBAC business_growth:read (export for Excel). Places follow the person (a branch manager = his places only, and never
 * company profit / salaries).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { checkPermission, normalizeRole } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import { requestPlaces } from '@/lib/places/server'
import { businessGrowth, canSeeBusiness } from '@/lib/business/engine'
import { createBrandedWorkbook } from '@/lib/excel/report-generator'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()
  const role = normalizeRole(session.user.role)
  if (!role || !canSeeBusiness(role)) return errors.forbidden()
  const sp = request.nextUrl.searchParams
  const user = { id: session.user.id, role }
  const places = await requestPlaces(user, sp.get('campusId') || null)
  try {
    const data = await businessGrowth(user, places, { months: Number(sp.get('months')) || 12 })
    if (sp.get('format') !== 'xlsx') return successResponse({ ...data, canEditTargets: checkPermission(role, 'business_growth', 'update') && (places.all || places.campusIds.length === 1) })
    if (!checkPermission(role, 'business_growth', 'export')) return errors.forbidden()

    const money = data.companyMoney
    const wb = await createBrandedWorkbook({
      title: 'Business growth', subtitle: `${data.months[0]} → ${data.months[data.months.length - 1]}`, sheetName: 'Months',
      columns: [
        { header: 'Month', key: 'ym', width: 10 }, { header: 'Income', key: 'income', width: 12 }, { header: 'Refunds', key: 'refunds', width: 11 },
        { header: 'Expenses', key: 'expenses', width: 12 }, ...(money ? [{ header: 'Salaries', key: 'salaries', width: 12 }, { header: 'Profit', key: 'profit', width: 12 }] : []),
        { header: 'Active students', key: 'active', width: 10 }, { header: 'New', key: 'newStudents', width: 8 }, { header: 'Stopped', key: 'stopped', width: 9 },
        { header: 'Continuation %', key: 'continuation', width: 12 }, { header: 'Attendance %', key: 'attendancePct', width: 12 }, { header: 'Sessions', key: 'sessions', width: 9 },
        { header: 'Collection %', key: 'collectionPct', width: 11 }, { header: 'Rating /5', key: 'rating', width: 9 }, { header: 'Complaints', key: 'complaints', width: 10 },
        { header: 'NPS', key: 'nps', width: 7 }, { header: 'Requests', key: 'requests', width: 9 }, { header: 'Referrals', key: 'referrals', width: 9 },
      ],
      rows: data.monthRows.map((r) => ({ ...r })) as unknown as Record<string, string | number>[],
    })
    const add = (name: string, rows: Record<string, unknown>[]) => {
      if (!rows.length) return
      const ws = wb.addWorksheet(name.slice(0, 31))
      const keys = Object.keys(rows[0])
      ws.addRow(keys).font = { bold: true }
      for (const r of rows) ws.addRow(keys.map((k) => (r[k] ?? '') as string | number))
      ws.columns.forEach((c) => { c.width = 16 })
    }
    const cmp = data.comparisons
    for (const [k, label] of [['campus', 'Places'], ['track', 'Tracks'], ['course', 'Courses'], ['level', 'Levels'], ['teacher', 'Instructors'], ['partner', 'Partners']] as const) {
      add(`${label} ${cmp.month}`, cmp[k].map(({ id: _id, ...x }) => x))
    }
    add('Where students stop', data.value.bands.map((b) => ({ months: b.en, students: b.count })))
    add('Needs attention', data.attention.map((a) => ({ level: a.level, en: a.en, ar: a.ar })))
    const buf = await wb.xlsx.writeBuffer()
    return new NextResponse(Buffer.from(buf as ArrayBuffer), {
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="business-growth-${data.current}.xlsx"` },
    })
  } catch (e) {
    console.error('business growth failed', e)
    return errors.internal()
  }
}
