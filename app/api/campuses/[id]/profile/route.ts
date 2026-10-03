/**
 * GET /api/campuses/[id]/profile — branch profile (phase A): details, team and
 * live numbers (active groups/students, this month's income = payments − refunds,
 * overdue invoices, students waiting, how full the branch is).
 */

import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { prepaidTotal } from '@/lib/wallet/engine'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'campuses', 'read')
  if (denied) return denied
  const { id } = await params
  const own = campusScope(role, session.user.campusId, null)
  if (own && own !== id) return errors.forbidden('You can only open your own branch')

  const campus = await prisma.campus.findUnique({ where: { id } })
  if (!campus) return errors.notFound('Branch')

  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const [admins, teachers, activeGroups, activeStudents, paid, refunded, overdue, waiting, manager] = await Promise.all([
    prisma.admin.findMany({ where: { campusId: id, isActive: true }, select: { userId: true, firstName: true, lastName: true, department: true, user: { select: { role: true, email: true, isActive: true } } } }),
    prisma.teacher.findMany({ where: { campusId: id, isActive: true }, select: { id: true, firstName: true, lastName: true, designation: true, phoneNumber: true } }),
    prisma.classSection.count({ where: { campusId: id, isActive: true, status: 'ACTIVE' } }),
    prisma.studentEnrollment.findMany({ where: { status: 'ACTIVE', classSection: { campusId: id, status: 'ACTIVE' } }, select: { studentId: true }, distinct: ['studentId'] }),
    prisma.feePayment.aggregate({ where: { paymentDate: { gte: monthStart }, invoice: { student: { campusId: id } } }, _sum: { amount: true } }),
    prisma.refund.findMany({ where: { status: 'APPROVED', approvedAt: { gte: monthStart } }, select: { studentId: true, amount: true } }),
    prisma.feeInvoice.count({ where: { student: { campusId: id }, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] }, dueDate: { lt: new Date() } } }),
    prisma.waitingListEntry.count({ where: { campusId: id, status: 'WAITING' } }),
    campus.managerUserId ? prisma.admin.findUnique({ where: { userId: campus.managerUserId }, select: { firstName: true, lastName: true } }) : null,
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
      manager: manager ? `${manager.firstName} ${manager.lastName}`.trim() : null,
    },
    team: {
      staff: admins.filter((a) => a.user.isActive).map((a) => ({ userId: a.userId, name: `${a.firstName} ${a.lastName}`.trim(), role: a.user.role, email: a.user.email, department: a.department })),
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
