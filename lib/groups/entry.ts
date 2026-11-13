/**
 * Six phases E (2026-11-13): entering a group only after payment (server only).
 * holdUntilPaid()  — right after a student is put in a group (booking or staff) and billed: when the group's policy says
 *                    AFTER_PAYMENT and the invoice is not paid enough, the seat stays theirs but they are AWAITING_PAYMENT:
 *                    not in attendance, lessons, live sessions or the upcoming sessions (every "ACTIVE" list leaves them out).
 * releaseAwaiting() — after every payment on the group (refreshGroupAfterPayment) and in the daily job: paid enough → ACTIVE.
 * openWithoutPayment() / removeAwaiting() — staff decisions on the group page (permission group_entry:approve / update).
 */

import { prisma } from '@/lib/prisma'
import { notifySeatFreed } from '@/lib/groups/capacity'
import { notifyFamilies } from '@/lib/notifications/events'
import { paidEnough, resolvePolicy, type Policy } from './policy'

export async function policyForGroup(groupId: string): Promise<Policy & { kind: string; installmentsAllowed: boolean }> {
  const g = await prisma.classSection.findUnique({
    where: { id: groupId },
    select: { id: true, kind: true, campusId: true, levelId: true, requireFullPaymentToStart: true, installmentsAllowed: true, level: { select: { subjectId: true, subject: { select: { trackId: true } } } } },
  })
  if (!g) throw new Error('Group not found')
  // recorded courses and One-to-One have their own payment rules
  if (g.kind !== 'GROUP') return { ...resolvePolicy([], {}), kind: g.kind, installmentsAllowed: g.installmentsAllowed }
  const rows = await prisma.groupPolicy.findMany()
  const p = resolvePolicy(rows, { campusId: g.campusId, trackId: g.level?.subject?.trackId, courseId: g.level?.subjectId, levelId: g.levelId, groupId: g.id }, g)
  return { ...p, kind: g.kind, installmentsAllowed: g.installmentsAllowed }
}

/** The student's latest open invoice in this group. */
export const currentInvoice = (studentId: string, groupId: string) =>
  prisma.feeInvoice.findFirst({ where: { studentId, classSectionId: groupId, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, select: { id: true, totalAmount: true, paidAmount: true, status: true } })

async function enoughFor(studentId: string, groupId: string, p: { installmentsAllowed: boolean; minPartPercent: number | null }) {
  const inv = await currentInvoice(studentId, groupId)
  return paidEnough(inv ? { totalAmount: Number(inv.totalAmount), paidAmount: Number(inv.paidAmount), status: inv.status } : null, p.installmentsAllowed, p.minPartPercent)
}

/** After joining + billing: AFTER_PAYMENT groups keep the seat but the student waits until the invoice is paid. Returns true when waiting. */
export async function holdUntilPaid(studentId: string, groupId: string, opts: { tellFamily?: boolean } = {}): Promise<boolean> {
  const p = await policyForGroup(groupId)
  if (p.entry !== 'AFTER_PAYMENT') return false
  if (await enoughFor(studentId, groupId, p)) return false
  const r = await prisma.studentEnrollment.updateMany({ where: { studentId, classSectionId: groupId, status: 'ACTIVE' }, data: { status: 'AWAITING_PAYMENT' } })
  if (r.count && opts.tellFamily !== false) {
    const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { className: true } })
    await notifyFamilies([studentId], 'BOOKING_UPDATE', (s) => ({
      title: `${s.firstName}: the seat in ${g?.className ?? 'the group'} is held — pay to join`, message: 'The student joins the sessions and lessons once the invoice is paid.',
      titleAr: `${s.firstName}: المكان في ${g?.className ?? 'الجروب'} محجوز — ادفع علشان يدخل`, messageAr: 'الطالب بيدخل الحصص والدروس أول ما الفاتورة تتدفع.', relatedId: groupId,
    })).catch(() => 0)
  }
  return r.count > 0
}

/** Students waiting in this group who have now paid enough join it. Returns how many joined. */
export async function releaseAwaiting(groupId: string): Promise<number> {
  const waiting = await prisma.studentEnrollment.findMany({ where: { classSectionId: groupId, status: 'AWAITING_PAYMENT' }, select: { id: true, studentId: true } })
  if (!waiting.length) return 0
  const p = await policyForGroup(groupId)
  const joined: string[] = []
  for (const w of waiting) {
    if (p.entry === 'NOW' || (await enoughFor(w.studentId, groupId, p))) {
      await prisma.studentEnrollment.update({ where: { id: w.id }, data: { status: 'ACTIVE' } })
      joined.push(w.studentId)
    }
  }
  if (joined.length) {
    await (await import('./start')).checkReady(groupId).catch(() => false)
    const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { className: true } })
    await notifyFamilies(joined, 'BOOKING_UPDATE', (s) => ({
      title: `${s.firstName} joined ${g?.className ?? 'the group'}`, message: 'Payment received: the sessions and lessons are open.',
      titleAr: `${s.firstName} دخل ${g?.className ?? 'الجروب'}`, messageAr: 'الدفع وصل: الحصص والدروس مفتوحة.', relatedId: groupId,
    })).catch(() => 0)
  }
  return joined.length
}

/** Every group with someone waiting (daily job). */
export async function releaseAllAwaiting() {
  const groups = await prisma.studentEnrollment.findMany({ where: { status: 'AWAITING_PAYMENT' }, select: { classSectionId: true }, distinct: ['classSectionId'], take: 500 })
  let joined = 0
  for (const g of groups) joined += await releaseAwaiting(g.classSectionId).catch(() => 0)
  return { joined }
}

/** Staff (group_entry:approve): this student joins now without paying first. */
export async function openWithoutPayment(groupId: string, studentId: string, staffId: string) {
  const r = await prisma.studentEnrollment.updateMany({ where: { studentId, classSectionId: groupId, status: 'AWAITING_PAYMENT' }, data: { status: 'ACTIVE' } })
  if (r.count) {
    await prisma.auditLog.create({ data: { userId: staffId, action: 'UPDATE', entityType: 'GroupEntry', entityId: `${groupId}:${studentId}`, changes: { openedWithoutPayment: true } } }).catch(() => null)
  }
  return r.count > 0
}

/** Staff: a waiting student leaves (unpaid invoice cancelled, seat freed). */
export async function removeAwaiting(groupId: string, studentId: string) {
  const r = await prisma.studentEnrollment.updateMany({ where: { studentId, classSectionId: groupId, status: 'AWAITING_PAYMENT' }, data: { status: 'WITHDRAWN', withdrawalReason: 'NOT_PAID' } })
  if (!r.count) return false
  const inv = await currentInvoice(studentId, groupId)
  if (inv && Number(inv.paidAmount) === 0) await prisma.feeInvoice.update({ where: { id: inv.id }, data: { status: 'CANCELLED', notes: 'Did not pay to join the group · مادفعش علشان يدخل الجروب' } })
  await prisma.courseBooking.updateMany({ where: { studentId, classSectionId: groupId, status: 'HOLD' }, data: { status: 'CANCELLED', reason: 'Removed by TechNova before paying · TechNova شالته قبل الدفع', holdUntil: null } })
  await notifySeatFreed(groupId).catch(() => null)
  return true
}
