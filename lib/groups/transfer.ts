/**
 * Move a student from one group to another. Server-only.
 * Design + owner's answers: docs/design-student-transfer.md. Maths: ./transfer-calc.ts.
 *
 *  - any course / level / time; whoever has group_transfers:create
 *  - the counted sessions stay due on the old invoice; what was paid above
 *    that is returned as an APPROVED refund to the wallet (so P&L, teacher %
 *    pay and the refunds list all see it), then — if staff chose so — paid
 *    from the wallet onto the new group's invoice (receipt, source WALLET)
 *  - unpaid rest of the old invoice is cancelled (total cut down)
 *  - staff decide for each of the student's discounts: move / keep / end
 *  - old enrollment WITHDRAWN (reason TRANSFERRED): attendance history stays
 *  - the old teacher's % share follows net paid (paid - refunded), so they
 *    keep their share of the counted sessions only
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { isUniqueConflictOn } from '@/lib/ids/sequence'
import { groupContext, typeMatchesScope } from '@/lib/discounts/engine'
import { nextRefundNumber, payFromWallet, resolveRefundRule } from '@/lib/refunds/engine'
import { sessionsPerCycle } from './cycle-rules'
import { generateMissingCycleInvoices } from './generate-invoices'
import { findGroupInstructorOffering } from './instructor'
import { groupSeats, notifySeatFreed } from './capacity'
import { computeTransferMoney, discountOptions, type DiscountAction, type TransferMoney } from './transfer-calc'

type Db = Prisma.TransactionClient | typeof prisma
const round2 = (n: number) => Math.round(n * 100) / 100

export const TRANSFER_REASON = 'TRANSFERRED'

async function loadGroup(db: Db, id: string) {
  const g = await db.classSection.findUnique({
    where: { id },
    select: {
      id: true, className: true, sectionName: true, campusId: true, isActive: true, status: true, startDate: true,
      scheduleSlots: true, currentCycleNumber: true, levelId: true,
      level: {
        select: {
          id: true, name: true, numberOfSessions: true, numberOfMonths: true, pricingType: true, monthlyPrice: true, fullLevelPrice: true,
          subject: { select: { id: true, name: true, track: { select: { id: true, name: true } } } },
        },
      },
      _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
    },
  })
  if (!g) return null
  const activeYearId = (await getActiveAcademicYear())?.id
  const offering = await findGroupInstructorOffering(id, activeYearId)
  const price = g.level ? Number(g.level.pricingType === 'MONTHLY' ? g.level.monthlyPrice ?? 0 : g.level.fullLevelPrice ?? 0) : 0
  return {
    id: g.id,
    label: `${g.className} ${g.sectionName}`.trim(),
    campusId: g.campusId,
    isActive: g.isActive,
    status: g.status,
    startDate: g.startDate,
    scheduleSlots: g.scheduleSlots,
    levelId: g.levelId,
    level: g.level ? { id: g.level.id, name: g.level.name, numberOfSessions: g.level.numberOfSessions, numberOfMonths: g.level.numberOfMonths, pricingType: g.level.pricingType } : null,
    course: g.level?.subject ? { id: g.level.subject.id, name: g.level.subject.name } : null,
    track: g.level?.subject?.track ?? null,
    teacher: offering?.teacher ? { id: offering.teacherId, name: `${offering.teacher.firstName} ${offering.teacher.lastName}` } : null,
    studentCount: g._count.enrollments,
    price,
  }
}
export type TransferGroup = NonNullable<Awaited<ReturnType<typeof loadGroup>>>

export interface TransferDiscountItem {
  assignmentId: string
  typeName: string
  valueType: string
  value: number
  scope: 'GROUP' | 'TRACK' | 'STUDENT'
  status: string
  options: DiscountAction[]
  suggested: DiscountAction
  /** The type itself is limited to a track/course/level/group the new group is not in */
  typeFitsNewGroup: boolean
}

export interface TransferPreview {
  student: { id: string; name: string }
  from: TransferGroup
  to: TransferGroup
  fromEnrollmentId: string
  invoice: (TransferMoney & {
    id: string
    challanNumber: string
    totalAmount: number
    paidAmount: number
    refundedAmount: number
    basis: 'ATTENDED' | 'HELD'
    sessionsInCycle: number | null
  }) | null
  /** The student already has an invoice for the new group's current cycle (e.g. was in it before) */
  newGroupInvoice: { id: string; challanNumber: string; totalAmount: number; paidAmount: number } | null
  discounts: TransferDiscountItem[]
  /** Seats in the new group (phase A capacity) */
  toSeats: { max: number | null; count: number; free: number | null; full: boolean }
}

export type PreviewOutcome = { ok: true; preview: TransferPreview } | { ok: false; status: number; message: string }

async function oldInvoiceOf(db: Db, studentId: string, classSectionId: string) {
  return db.feeInvoice.findFirst({
    where: { studentId, classSectionId, status: { not: 'CANCELLED' } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, challanNumber: true, totalAmount: true, paidAmount: true, refundedAmount: true, status: true, notes: true, proofStatus: true,
      level: { select: { numberOfSessions: true, numberOfMonths: true, pricingType: true } },
    },
  })
}

async function countSessions(db: Db, basis: 'ATTENDED' | 'HELD', classSectionId: string, studentId: string) {
  if (basis === 'HELD') {
    const dates = await db.enrollmentAttendanceRecord.findMany({
      where: { studentEnrollment: { classSectionId } },
      select: { attendanceDate: true },
      distinct: ['attendanceDate'],
    })
    return dates.length
  }
  return db.enrollmentAttendanceRecord.count({
    where: { studentEnrollment: { classSectionId, studentId }, status: { in: ['PRESENT', 'LATE'] } },
  })
}

export async function previewTransfer(studentId: string, fromId: string, toId: string, db: Db = prisma): Promise<PreviewOutcome> {
  if (fromId === toId) return { ok: false, status: 400, message: 'Choose a different group' }
  const student = await db.student.findUnique({ where: { id: studentId }, select: { id: true, firstName: true, lastName: true } })
  if (!student) return { ok: false, status: 404, message: 'Student not found' }
  const [from, to] = await Promise.all([loadGroup(db, fromId), loadGroup(db, toId)])
  if (!from || !to) return { ok: false, status: 404, message: 'Group not found' }
  if (!to.isActive || to.status !== 'ACTIVE') return { ok: false, status: 409, message: 'The new group is finished or closed' }
  if (!to.level) return { ok: false, status: 409, message: 'The new group has no level set' }

  const enrollments = await db.studentEnrollment.findMany({
    where: { studentId, classSectionId: { in: [fromId, toId] } },
    select: { id: true, classSectionId: true, status: true },
  })
  const fromEnr = enrollments.find((e) => e.classSectionId === fromId && e.status === 'ACTIVE')
  if (!fromEnr) return { ok: false, status: 409, message: 'The student is not active in this group' }
  if (enrollments.some((e) => e.classSectionId === toId && e.status === 'ACTIVE')) {
    return { ok: false, status: 409, message: 'The student is already in the new group' }
  }

  // ── money (old invoice) ──
  let invoice: TransferPreview['invoice'] = null
  const inv = await oldInvoiceOf(db, studentId, fromId)
  if (inv) {
    const pendingRefund = await db.refund.count({ where: { invoiceId: inv.id, status: 'PENDING' } })
    if (pendingRefund) return { ok: false, status: 409, message: 'A refund on the old invoice is waiting for approval. Approve or reject it first.' }
    if (inv.proofStatus === 'PENDING') return { ok: false, status: 409, message: 'A payment proof on the old invoice is waiting for review. Review it first.' }
    const rule = await resolveRefundRule(db, await groupContext(db, fromId))
    const levelForCycle = inv.level ?? from.level
    const sessionsInCycle = levelForCycle ? sessionsPerCycle(levelForCycle) : null
    const sessionsCounted = await countSessions(db, rule.deductBasis, fromId, studentId)
    const money = computeTransferMoney({
      totalAmount: Number(inv.totalAmount), paidAmount: Number(inv.paidAmount), refundedAmount: Number(inv.refundedAmount),
      sessionsInCycle, sessionsCounted,
    })
    invoice = {
      ...money,
      id: inv.id, challanNumber: inv.challanNumber,
      totalAmount: Number(inv.totalAmount), paidAmount: Number(inv.paidAmount), refundedAmount: Number(inv.refundedAmount),
      basis: rule.deductBasis, sessionsInCycle,
    }
  }

  // ── an invoice for the new group's current cycle already there? ──
  const cycleNumber = to.level.pricingType === 'MONTHLY' ? (await db.classSection.findUnique({ where: { id: toId }, select: { currentCycleNumber: true } }))?.currentCycleNumber ?? null : null
  const existingNew = await db.feeInvoice.findFirst({
    where: { studentId, classSectionId: toId, cycleNumber, status: { not: 'CANCELLED' } },
    select: { id: true, challanNumber: true, totalAmount: true, paidAmount: true },
  })

  // ── discounts ──
  const toCtx = await groupContext(db, toId)
  const assignments = await db.discountAssignment.findMany({
    where: { studentId, status: { in: ['ACTIVE', 'PENDING'] } },
    include: { discountType: { select: { name: true, valueType: true, scopeType: true, scopeId: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const discounts: TransferDiscountItem[] = []
  for (const a of assignments) {
    const typeFitsNewGroup = typeMatchesScope(a.discountType, toCtx)
    const opt = discountOptions(a, { fromClassSectionId: fromId, toTrackId: to.track?.id ?? null, typeFitsNewGroup })
    if (!opt) continue
    discounts.push({
      assignmentId: a.id,
      typeName: a.discountType.name,
      valueType: a.discountType.valueType,
      value: Number(a.value),
      scope: a.classSectionId ? 'GROUP' : a.trackId ? 'TRACK' : 'STUDENT',
      status: a.status,
      options: opt.options,
      suggested: opt.suggested,
      typeFitsNewGroup,
    })
  }

  return {
    ok: true,
    preview: {
      student: { id: student.id, name: `${student.firstName} ${student.lastName}` },
      from, to,
      fromEnrollmentId: fromEnr.id,
      invoice,
      newGroupInvoice: existingNew ? { id: existingNew.id, challanNumber: existingNew.challanNumber, totalAmount: Number(existingNew.totalAmount), paidAmount: Number(existingNew.paidAmount) } : null,
      discounts,
      toSeats: await groupSeats(toId, db),
    },
  }
}

// ── execute ─────────────────────────────────────────────────────────────────
export interface ExecuteTransferInput {
  studentId: string
  fromClassSectionId: string
  toClassSectionId: string
  creditTo: 'NEW_INVOICE' | 'WALLET'
  discountDecisions: { assignmentId: string; action: DiscountAction }[]
  reason?: string | null
  userId: string
  /** The new group is full: move anyway (the route checks group_capacity:approve) */
  overrideCapacity?: boolean
}

export type ExecuteOutcome =
  | {
      ok: true
      transferId: string
      credit: number
      creditTo: 'NEW_INVOICE' | 'WALLET'
      creditApplied: number
      creditLeftInWallet: number
      refundNumber: string | null
      receiptPaymentId: string | null
      newInvoiceId: string | null
      oldInvoice: { owed: number; cancelled: number } | null
      warning: string | null
    }
  | { ok: false; status: number; message: string }

class TransferError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function executeTransfer(input: ExecuteTransferInput): Promise<ExecuteOutcome> {
  const pre = await previewTransfer(input.studentId, input.fromClassSectionId, input.toClassSectionId)
  if ('message' in pre) return { ok: false, status: pre.status, message: pre.message }
  const p = pre.preview
  if (p.toSeats.full && !input.overrideCapacity) {
    return { ok: false, status: 409, message: `The new group is full (${p.toSeats.count}/${p.toSeats.max}). Choose another group, or move anyway with the “Group capacity” permission.` }
  }

  // Staff must have answered for every discount (the owner: "ask first").
  const decisions = new Map(input.discountDecisions.map((d) => [d.assignmentId, d.action]))
  for (const d of p.discounts) {
    const action = decisions.get(d.assignmentId)
    if (!action || !d.options.includes(action)) {
      return { ok: false, status: 400, message: `Choose what happens to the discount “${d.typeName}”` }
    }
  }

  const activeYear = await getActiveAcademicYear()
  if (!activeYear) return { ok: false, status: 409, message: 'No active academic year is set' }

  let out: { transferId: string; credit: number; refundNumber: string | null; owed: number; cancelled: number }
  try {
    out = await prisma.$transaction(async (tx) => {
      // The student must still be in the old group.
      const moved = await tx.studentEnrollment.updateMany({
        where: { id: p.fromEnrollmentId, status: 'ACTIVE' },
        data: { status: 'WITHDRAWN', withdrawalReason: TRANSFER_REASON },
      })
      if (moved.count !== 1) throw new TransferError(409, 'The student was just changed in the old group; try again')

      // ── old invoice ──
      let credit = 0
      let refundId: string | null = null
      let refundNumber: string | null = null
      let owed = 0
      let cancelled = 0
      if (p.invoice) {
        const inv = await tx.feeInvoice.findUnique({
          where: { id: p.invoice.id },
          select: { totalAmount: true, paidAmount: true, refundedAmount: true, status: true, notes: true },
        })
        if (!inv) throw new TransferError(409, 'The old invoice was just changed; try again')
        const money = computeTransferMoney({
          totalAmount: Number(inv.totalAmount), paidAmount: Number(inv.paidAmount), refundedAmount: Number(inv.refundedAmount),
          sessionsInCycle: p.invoice.sessionsInCycle, sessionsCounted: p.invoice.sessionsCounted,
        })
        credit = money.credit
        owed = money.owed
        cancelled = money.cancelled
        const status = money.newTotal <= 0
          ? 'CANCELLED'
          : money.owed <= 0
            ? 'PAID'
            : Number(inv.paidAmount) > 0
              ? 'PARTIALLY_PAID'
              : inv.status === 'OVERDUE' ? 'OVERDUE' : 'ISSUED'
        const note = `Moved to group ${p.to.label} on ${new Date().toISOString().slice(0, 10)}: ${money.sessionsCounted} session(s) counted (${money.consumed} EGP)` +
          (money.credit > 0 ? `, ${money.credit} EGP credit` : '') + (money.cancelled > 0 ? `, ${money.cancelled} EGP cancelled` : '')
        // Guarded: nobody paid/refunded in between.
        const upd = await tx.feeInvoice.updateMany({
          where: { id: p.invoice.id, paidAmount: inv.paidAmount, refundedAmount: inv.refundedAmount },
          data: {
            totalAmount: money.newTotal,
            refundedAmount: { increment: money.credit },
            status,
            notes: inv.notes ? `${inv.notes}\n${note}` : note,
          },
        })
        if (upd.count !== 1) throw new TransferError(409, 'The old invoice was just changed; try again')

        if (money.credit > 0) {
          const refund = await tx.refund.create({
            data: {
              invoiceId: p.invoice.id,
              studentId: input.studentId,
              suggestedAmount: money.credit,
              amount: money.credit,
              method: 'WALLET',
              reason: `Group transfer: ${p.from.label} → ${p.to.label}`,
              calc: { transfer: true, netPaid: money.netPaid, perSession: money.perSession, sessionsCounted: money.sessionsCounted, basis: p.invoice.basis, deduction: money.consumed, adminFee: 0 } as Prisma.InputJsonValue,
              requestedById: input.userId,
            },
          })
          refundId = refund.id
          for (let attempt = 0; ; attempt++) {
            refundNumber = await nextRefundNumber(tx)
            try {
              await tx.refund.update({ where: { id: refund.id }, data: { status: 'APPROVED', approvedById: input.userId, approvedAt: new Date(), refundNumber } })
              break
            } catch (err) {
              if (attempt < 4 && isUniqueConflictOn(err, 'refundNumber')) continue
              throw err
            }
          }
          await tx.walletTransaction.create({
            data: { studentId: input.studentId, amount: money.credit, type: 'REFUND', refundId: refund.id, note: `Credit from group ${p.from.label} (${refundNumber})`, createdById: input.userId },
          })
          const st = await tx.student.findUnique({ where: { id: input.studentId }, select: { paidAmount: true } })
          await tx.student.update({ where: { id: input.studentId }, data: { paidAmount: Math.max(0, round2(Number(st?.paidAmount ?? 0) - money.credit)) } })
        }
      }

      // ── new enrollment (reuse an old one in that group: history comes back) ──
      const existing = await tx.studentEnrollment.findFirst({ where: { studentId: input.studentId, classSectionId: input.toClassSectionId } })
      let toEnrollmentId: string
      if (existing) {
        if (existing.status === 'ACTIVE') throw new TransferError(409, 'The student is already in the new group')
        await tx.studentEnrollment.update({ where: { id: existing.id }, data: { status: 'ACTIVE', withdrawalReason: null } })
        toEnrollmentId = existing.id
      } else {
        let created = null
        for (let attempt = 0; !created; attempt++) {
          try {
            created = await tx.studentEnrollment.create({
              data: {
                studentId: input.studentId,
                academicYearId: activeYear.id,
                classSectionId: input.toClassSectionId,
                rollNumber: String(Math.floor(Math.random() * 9000) + 1000),
              },
            })
          } catch (err) {
            if (attempt < 4 && isUniqueConflictOn(err, 'rollNumber')) continue
            throw err
          }
        }
        toEnrollmentId = created.id
      }

      // ── discounts ──
      const decisionLog: { assignmentId: string; typeName: string; action: DiscountAction }[] = []
      for (const d of p.discounts) {
        const action = decisions.get(d.assignmentId)!
        decisionLog.push({ assignmentId: d.assignmentId, typeName: d.typeName, action })
        if (action === 'MOVE') {
          await tx.discountAssignment.update({ where: { id: d.assignmentId }, data: { classSectionId: input.toClassSectionId } })
        } else if (action === 'END') {
          await tx.discountAssignment.update({ where: { id: d.assignmentId }, data: { status: 'ENDED', endedAt: new Date(), endedById: input.userId } })
        }
      }

      // ── waiting list: a wish for the new group's course is fulfilled ──
      if (p.to.course) {
        await tx.waitingListEntry.updateMany({
          where: { studentId: input.studentId, status: 'WAITING', subjectId: p.to.course.id, OR: [{ levelId: null }, { levelId: p.to.levelId }] },
          data: { status: 'PLACED', placedClassSectionId: input.toClassSectionId, placedAt: new Date() },
        })
      }

      const transfer = await tx.groupTransfer.create({
        data: {
          studentId: input.studentId,
          fromClassSectionId: input.fromClassSectionId,
          toClassSectionId: input.toClassSectionId,
          fromEnrollmentId: p.fromEnrollmentId,
          toEnrollmentId,
          oldInvoiceId: p.invoice?.id ?? null,
          sessionsCounted: p.invoice?.sessionsCounted ?? 0,
          perSession: p.invoice?.perSession ?? 0,
          consumedAmount: p.invoice?.consumed ?? 0,
          netPaidBefore: p.invoice?.netPaid ?? 0,
          creditAmount: credit,
          creditTo: input.creditTo,
          cancelledAmount: cancelled,
          refundId,
          discountDecisions: decisionLog as unknown as Prisma.InputJsonValue,
          reason: input.reason ?? null,
          createdById: input.userId,
        },
      })
      await tx.auditLog.create({
        data: {
          userId: input.userId, action: 'CREATE', entityType: 'GroupTransfer', entityId: transfer.id,
          changes: { studentId: input.studentId, from: input.fromClassSectionId, to: input.toClassSectionId, credit, creditTo: input.creditTo, refundNumber, cancelled, discounts: decisionLog } as Prisma.InputJsonValue,
        },
      })
      return { transferId: transfer.id, credit, refundNumber, owed, cancelled }
    })
  } catch (err) {
    if (err instanceof TransferError) return { ok: false, status: err.status, message: err.message }
    throw err
  }

  // ── bill the new group (same as adding a student) ──
  let warning: string | null = null
  try {
    await generateMissingCycleInvoices(input.toClassSectionId, input.userId, input.studentId)
  } catch (err) {
    console.error('[TRANSFER_NEW_INVOICE]', err)
    warning = 'The student was moved, but the new invoice could not be created. Use “Generate invoices” on the new group.'
  }
  const newInv = await prisma.feeInvoice.findFirst({
    where: { studentId: input.studentId, classSectionId: input.toClassSectionId, status: { not: 'CANCELLED' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  })

  // ── credit onto the new invoice (from the wallet, with a receipt) ──
  let creditApplied = 0
  let paymentId: string | null = null
  if (input.creditTo === 'NEW_INVOICE' && out.credit > 0 && newInv && newInv.status !== 'PAID') {
    const r = await payFromWallet(newInv.id, input.userId, out.credit, { remarks: `Credit moved from group ${p.from.label}`, allowPartial: true })
    if ('payment' in r) {
      creditApplied = r.amount
      paymentId = r.payment.id
    } else {
      warning = `The credit stayed in the wallet: ${'message' in r ? r.message : ''}`
    }
  }
  await prisma.groupTransfer.update({
    where: { id: out.transferId },
    data: { newInvoiceId: newInv?.id ?? null, creditApplied, paymentId },
  })

  await notifyTeachers(p, input.userId)
  await notifySeatFreed(input.fromClassSectionId)

  return {
    ok: true,
    transferId: out.transferId,
    credit: out.credit,
    creditTo: input.creditTo,
    creditApplied,
    creditLeftInWallet: round2(out.credit - creditApplied),
    refundNumber: out.refundNumber,
    receiptPaymentId: paymentId,
    newInvoiceId: newInv?.id ?? null,
    oldInvoice: p.invoice ? { owed: out.owed, cancelled: out.cancelled } : null,
    warning,
  }
}

async function notifyTeachers(p: TransferPreview, actingUserId: string) {
  try {
    const ids = [p.from.teacher?.id, p.to.teacher?.id].filter((x): x is string => !!x)
    if (!ids.length) return
    const teachers = await prisma.teacher.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true } })
    const rows = teachers
      .filter((t) => t.userId !== actingUserId)
      .map((t) => ({
        userId: t.userId,
        title: t.id === p.to.teacher?.id ? 'New student in your group' : 'Student moved out of your group',
        message: t.id === p.to.teacher?.id
          ? `${p.student.name} moved into ${p.to.label} (from ${p.from.label})`
          : `${p.student.name} moved from ${p.from.label} to ${p.to.label}`,
        type: 'GROUP_TRANSFER',
        relatedId: p.student.id,
      }))
    if (rows.length) await prisma.notification.createMany({ data: rows })
  } catch (err) {
    console.error('[TRANSFER_NOTIFY]', err)
  }
}

/** Transfers of one student, newest first, with group names. */
export async function listTransfers(studentId: string) {
  const rows = await prisma.groupTransfer.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' } })
  const groupIds = [...new Set(rows.flatMap((r) => [r.fromClassSectionId, r.toClassSectionId]))]
  const userIds = [...new Set(rows.map((r) => r.createdById))]
  const [groups, users] = await Promise.all([
    prisma.classSection.findMany({ where: { id: { in: groupIds } }, select: { id: true, className: true, sectionName: true, level: { select: { name: true, subject: { select: { name: true } } } } } }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } }),
  ])
  const g = new Map(groups.map((x) => [x.id, { label: `${x.className} ${x.sectionName}`.trim(), course: x.level?.subject?.name ?? null, level: x.level?.name ?? null }]))
  const u = new Map(users.map((x) => [x.id, x.email]))
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    from: g.get(r.fromClassSectionId) ?? null,
    to: g.get(r.toClassSectionId) ?? null,
    sessionsCounted: r.sessionsCounted,
    consumedAmount: Number(r.consumedAmount),
    creditAmount: Number(r.creditAmount),
    creditTo: r.creditTo,
    creditApplied: Number(r.creditApplied),
    cancelledAmount: Number(r.cancelledAmount),
    discountDecisions: r.discountDecisions,
    reason: r.reason,
    by: u.get(r.createdById) ?? null,
  }))
}
