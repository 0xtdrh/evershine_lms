/**
 * GET /api/teachers/[id]/group-pay-summary?month=June 2026
 * What this teacher has earned across their currently-active groups this
 * cycle, split into what a salary slip needs:
 *   - earnings: fixed + % of payments + per-session pay (per group)
 *   - bonuses / deductions: manual adjustments, plus substitute-coverage
 *     adjustments (an extra session covered, a session missed) — each with
 *     its reason
 * Substitute-coverage adjustments are limited to the requested month (by
 * the date of the session itself) so last month's aren't pulled in again.
 * Only reads — it never marks anything as "used", so the accountant
 * reviewing the slip is the one who avoids double-counting across slips.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { computeTeacherGroupPay } from '@/lib/groups/teacher-pay'
import type { Role } from '@prisma/client'

const round2 = (n: number) => Math.round(n * 100) / 100

/** "June 2026" -> that month's [start, next month start), or null if unparseable. */
function monthRange(monthText: string | null): { gte: Date; lt: Date } | null {
  if (!monthText) return null
  const d = new Date(`1 ${monthText} UTC`)
  if (isNaN(d.getTime())) return null
  return {
    gte: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)),
    lt: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)),
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'fees', 'read')
  if (denied) return denied

  const { id } = await params
  // Accepts either a Teacher.id or a User.id (the two pages that call this
  // reference teachers differently) — try Teacher.id first, then fall back.
  const teacher = await prisma.teacher.findFirst({
    where: { OR: [{ id }, { userId: id }] },
    select: { id: true, firstName: true, lastName: true },
  })
  if (!teacher) return errors.notFound('Teacher')

  const range = monthRange(request.nextUrl.searchParams.get('month'))

  // Substitute-coverage adjustments for this teacher, across every group
  // (including ones they aren't assigned to — a covering teacher isn't).
  const substituteRows = await prisma.teacherPayAdjustment.findMany({
    where: { teacherId: teacher.id, substituteAssignmentId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, amount: true, reason: true, classSectionId: true,
      classSection: { select: { className: true, sectionName: true } },
      substituteAssignment: { select: { date: true } },
    },
  })
  const substituteIds = new Set(substituteRows.map((r) => r.id))
  const substituteAdjustments = substituteRows
    .filter((r) => {
      if (!range) return true
      const d = r.substituteAssignment?.date
      return !!d && d >= range.gte && d < range.lt
    })
    .map((r) => ({
      id: r.id,
      classSectionId: r.classSectionId,
      groupLabel: r.classSection ? `${r.classSection.className} ${r.classSection.sectionName}`.trim() : '',
      amount: Number(r.amount),
      reason: r.reason,
      sessionDate: r.substituteAssignment?.date ?? null,
    }))

  const offerings = await prisma.subjectOffering.findMany({
    where: { teacherId: teacher.id },
    distinct: ['classSectionId'],
    select: {
      classSectionId: true,
      classSection: {
        select: { id: true, className: true, sectionName: true, currentCycleNumber: true, isActive: true },
      },
    },
  })

  const groups = []
  let earnings = 0
  let bonuses = 0
  let deductions = 0
  for (const o of offerings) {
    if (!o.classSection.isActive) continue
    const breakdown = await computeTeacherGroupPay(o.classSectionId, teacher.id, o.classSection.currentCycleNumber)
    const earned = breakdown.fixedAmount + breakdown.percentAmount + breakdown.sessionAmount
    // Substitute-coverage adjustments are reported separately (month-
    // filtered) above, so only manual ones are counted per group here.
    const manualAdjustments = breakdown.adjustments.filter((a) => !substituteIds.has(a.id))
    if (earned === 0 && manualAdjustments.length === 0) continue

    let manualNet = 0
    for (const a of manualAdjustments) {
      manualNet += a.amount
      if (a.amount >= 0) bonuses += a.amount
      else deductions += -a.amount
    }
    earnings += earned
    groups.push({
      classSectionId: o.classSectionId,
      groupLabel: `${o.classSection.className} ${o.classSection.sectionName}`.trim(),
      earned: round2(earned),
      sessionsCounted: breakdown.sessionsCounted,
      perSessionAmount: breakdown.perSessionAmount,
      adjustments: manualAdjustments,
      total: round2(earned + manualNet),
    })
  }

  for (const a of substituteAdjustments) {
    if (a.amount >= 0) bonuses += a.amount
    else deductions += -a.amount
  }

  const totals = {
    earnings: round2(earnings),
    bonuses: round2(bonuses),
    deductions: round2(deductions),
    net: round2(earnings + bonuses - deductions),
  }

  return successResponse({
    teacherName: `${teacher.firstName} ${teacher.lastName}`,
    groups,
    substituteAdjustments,
    totals,
    total: totals.net,
  })
}
