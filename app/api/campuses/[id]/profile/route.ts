/**
 * GET /api/campuses/[id]/profile — branch profile (phase A): details, team and
 * live numbers (active groups/students, this month's income = payments − refunds,
 * overdue invoices, students waiting, how full the branch is).
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { loadPlaces, teachersOfPlaceWhere } from '@/lib/places/server'
import { allowsCampus } from '@/lib/places/rules'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { prepaidTotal } from '@/lib/wallet/engine'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'campuses', 'read')
  if (denied) return denied
  const { id } = await params
  // M0: only branches among the person's places
  if (!allowsCampus(await loadPlaces(session.user), id)) return errors.forbidden('You can only open your own branch')

  const campus = await prisma.campus.findUnique({ where: { id } })
  if (!campus) return errors.notFound('Branch')

  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const [admins, teachers, activeGroups, activeStudents, paid, refunded, overdue, waiting, manager] = await Promise.all([
    staffOfBranch(id),
    prisma.teacher.findMany({ where: { isActive: true, ...teachersOfPlaceWhere(id) }, select: { id: true, firstName: true, lastName: true, designation: true, phoneNumber: true } }),
    prisma.classSection.count({ where: { campusId: id, isActive: true, status: 'ACTIVE' } }),
    prisma.studentEnrollment.findMany({ where: { status: 'ACTIVE', classSection: { campusId: id, status: 'ACTIVE' } }, select: { studentId: true }, distinct: ['studentId'] }),
    prisma.feePayment.aggregate({ where: { paymentDate: { gte: monthStart }, invoice: { student: { campusId: id } } }, _sum: { amount: true } }),
    prisma.refund.findMany({ where: { status: 'APPROVED', approvedAt: { gte: monthStart } }, select: { studentId: true, amount: true } }),
    prisma.feeInvoice.count({ where: { student: { campusId: id }, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] }, dueDate: { lt: new Date() } } }),
    prisma.waitingListEntry.count({ where: { campusId: id, status: 'WAITING' } }),
    campus.managerUserId ? prisma.user.findUnique({ where: { id: campus.managerUserId }, select: { displayName: true, email: true } }) : null,
  ])
  // Refund has no relation to Student: keep only this branch's students.
  const inBranch = new Set((await prisma.student.findMany({ where: { id: { in: [...new Set(refunded.map((r) => r.studentId))] }, campusId: id }, select: { id: true } })).map((s) => s.id))
  const refundedSum = refunded.filter((r) => inBranch.has(r.studentId)).reduce((a, r) => a + Number(r.amount), 0)
  const income = Number(paid._sum.amount ?? 0) - refundedSum
  const students = activeStudents.length

  return successResponse({
    campus: {
      id: campus.id, name: campus.name, code: campus.code, address: campus.address, phone: campus.phone, email: campus.email,
      mapUrl: campus.mapUrl, whatsapp: campus.whatsapp, workingHours: campus.workingHours, roomsCount: campus.roomsCount,
      maxStudents: campus.maxStudents, managerUserId: campus.managerUserId, profileNotes: campus.profileNotes, isActive: campus.isActive,
      manager: (campus.managerUserId && admins.find((a) => a.userId === campus.managerUserId)?.name) || manager?.displayName || manager?.email || null,
      principalName: campus.principalName || null,
    },
    team: {
      staff: admins,
      instructors: teachers.map((t) => ({ id: t.id, name: `${t.firstName} ${t.lastName}`.trim(), designation: t.designation, phone: t.phoneNumber })),
    },
    stats: {
      activeGroups,
      activeStudents: students,
      monthIncome: Math.round(income * 100) / 100,
      overdueInvoices: overdue,
      waiting,
      fullness: campus.maxStudents ? Math.round((students / campus.maxStudents) * 100) : null,
      prepaid: await prepaidTotal(id),
    },
  })
}

type StaffRow = { userId: string; name: string; role: string; email: string; department: string | null }

/**
 * Staff accounts whose primary place is this branch. 2026-10-20 (live test): secretaries, accountants, branch managers
 * and marketing live in their own tables — reading only Admin left them out of the branch profile.
 */
async function staffOfBranch(campusId: string): Promise<StaffRow[]> {
  const u = { select: { role: true, email: true, isActive: true } } as const
  const base = { where: { campusId, isActive: true }, select: { userId: true, firstName: true, lastName: true, user: u } } as const
  const [admins, managers, secretaries, accountants, marketing] = await Promise.all([
    prisma.admin.findMany({ where: base.where, select: { ...base.select, department: true } }),
    prisma.branchManager.findMany({ where: base.where, select: { ...base.select, department: true } }),
    prisma.secretary.findMany(base),
    prisma.accountant.findMany(base),
    prisma.marketingStaff.findMany(base),
  ])
  const rows: StaffRow[] = []
  const seen = new Set<string>()
  for (const a of [...managers, ...admins, ...secretaries, ...accountants, ...marketing] as { userId: string; firstName: string; lastName: string; department?: string | null; user: { role: string; email: string; isActive: boolean } }[]) {
    if (!a.user.isActive || seen.has(a.userId)) continue
    seen.add(a.userId)
    rows.push({ userId: a.userId, name: `${a.firstName} ${a.lastName}`.trim(), role: a.user.role, email: a.user.email, department: a.department ?? null })
  }
  return rows
}
