/**
 * GET /api/teachers/[id]/pay-statement?month=YYYY-MM&campusId=&groupId=(&format=xlsx) — instructor pay statement
 * (2026-10-26). [id] = Teacher.id or User.id. Staff with salaries:read (only instructors of their places); the instructor
 * himself only while "instructors see their own salary slips" is on. Excel = one line per session / student share /
 * fixed amount / bonus / deduction. Never shows what a student paid.
 */

import { NextRequest, NextResponse } from 'next/server'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { canSeeTeacher, groupWhere, loadPlaces } from '@/lib/places/server'
import { teacherSeesOwnSlips } from '@/lib/salaries/settings'
import { teacherPayStatement } from '@/lib/teachers/pay-statement'
import { createBrandedWorkbook } from '@/lib/excel/report-generator'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const { id } = await params
  const sp = request.nextUrl.searchParams
  const month = sp.get('month') ?? ''
  if (!/^\d{4}-\d{2}$/.test(month)) return errors.badRequest('month must be YYYY-MM · الشهر لازم يبقى بالشكل YYYY-MM')

  const teacher = await prisma.teacher.findFirst({ where: { OR: [{ id }, { userId: id }] }, select: { id: true, userId: true } })
  if (!teacher) return errors.notFound('Instructor')

  const isFinance = checkPermission(session.user.role, 'salaries', 'read')
  let groupFilter: Record<string, unknown> = {}
  if (isFinance) {
    if (!(await canSeeTeacher(session.user, teacher.id))) return errors.forbidden()
    groupFilter = groupWhere(await loadPlaces(session.user))
  } else if (session.user.role === 'TEACHER' && teacher.userId === session.user.id) {
    if (!(await teacherSeesOwnSlips())) return errors.forbidden('Pay statements are not shown to instructors (Salary slips → settings)')
  } else {
    return errors.forbidden()
  }

  const st = await teacherPayStatement(teacher.id, month, { campusId: sp.get('campusId') || null, groupId: sp.get('groupId') || null, groupFilter })
  if (!st) return errors.badRequest('Could not build the statement')
  if (sp.get('format') !== 'xlsx') return successResponse(st)

  // Excel: one row per paid thing, then the total
  const rows: Record<string, string | number>[] = []
  for (const g of st.groups) {
    for (const s of g.sessions) rows.push({
      group: g.label, place: g.place, kind: s.counted ? 'Session' : s.otherTeacher ? `Covered by ${s.otherTeacher}` : 'Session (not paid)',
      date: s.date, detail: s.n ? `${s.n}${s.of ? ` / ${s.of}` : ''}` : '', amount: s.counted ? (g.rule.perSession ?? 0) : 0,
    })
    for (const x of g.studentShares) rows.push({ group: g.label, place: g.place, kind: `Share ${g.rule.percent}%`, date: '', detail: x.student, amount: x.share })
    if (g.fixedAmount) rows.push({ group: g.label, place: g.place, kind: 'Fixed', date: '', detail: '', amount: g.fixedAmount })
    for (const a of g.adjustments) rows.push({ group: g.label, place: g.place, kind: a.amount >= 0 ? 'Bonus' : 'Deduction', date: a.date, detail: a.reason, amount: a.amount })
  }
  for (const a of st.general) rows.push({ group: '', place: '', kind: a.amount >= 0 ? 'Bonus' : 'Deduction', date: a.date, detail: a.reason, amount: a.amount })
  rows.push({ group: 'TOTAL', place: '', kind: '', date: '', detail: `${st.totals.sessions} sessions`, amount: st.totals.net })
  const wb = await createBrandedWorkbook({
    title: `Pay statement — ${st.teacher.name}`, subtitle: `${month}${st.scope.label ? ` · ${st.scope.label}` : ''}`, sheetName: 'Pay statement',
    columns: [
      { header: 'Group', key: 'group', width: 22 }, { header: 'Place', key: 'place', width: 18 }, { header: 'Item', key: 'kind', width: 24 },
      { header: 'Date', key: 'date', width: 12 }, { header: 'Detail', key: 'detail', width: 30 }, { header: 'Amount (EGP)', key: 'amount', width: 14 },
    ],
    rows,
  })
  const buf = await wb.xlsx.writeBuffer()
  return new NextResponse(Buffer.from(buf as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="pay-statement-${month}.xlsx"`,
    },
  })
}
