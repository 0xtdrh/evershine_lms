/**
 * Refunds + student wallet. Server-only. Design: docs/design-discounts.md part 3.
 *
 * Owner's rules (2026-10-02):
 *  - allowed or not per scope (all / track / course / level / group) — RefundRule,
 *    the most specific rule wins
 *  - the sessions already consumed are deducted (attended, or held — per rule)
 *    and an admin fee (fixed or % of what was paid)
 *  - the result is cash back OR credit in the student's wallet
 *  - anyone with refunds:approve approves; refunds:create only requests
 *  - the teacher's % is computed on what the company keeps (paid - refunded)
 * Accounting: P&L income = payments - approved refunds (by approval date).
 * Wallet credit comes back as income when the wallet pays an invoice, so
 * nothing is counted twice.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { isUniqueConflictOn, nextInSequence } from '@/lib/ids/sequence'
import { groupContext, type GroupContext } from '@/lib/discounts/engine'
import { sessionsPerCycle } from '@/lib/groups/cycle-rules'
import { PaymentRefusedError, recordPayment } from '@/lib/fees/record-payment'
import { notifySeatFreed } from '@/lib/groups/capacity'

type Db = Prisma.TransactionClient | typeof prisma
const round2 = (n: number) => Math.round(n * 100) / 100

// ── rules ───────────────────────────────────────────────────────────────────
export interface ResolvedRule {
  id: string | null
  scopeType: string
  allowed: boolean
  adminFeeType: 'FIXED' | 'PERCENT'
  adminFeeValue: number
  deductBasis: 'ATTENDED' | 'HELD'
}
/** No rule at all: refunds allowed, no admin fee, attended sessions deducted. */
export const DEFAULT_REFUND_RULE: ResolvedRule = { id: null, scopeType: 'ALL', allowed: true, adminFeeType: 'FIXED', adminFeeValue: 0, deductBasis: 'ATTENDED' }

const SPECIFICITY = ['GROUP', 'LEVEL', 'COURSE', 'TRACK', 'ALL']

export async function resolveRefundRule(db: Db, ctx: GroupContext | null): Promise<ResolvedRule> {
  const rules = await db.refundRule.findMany()
  const matches = rules.filter((r) => {
    if (r.scopeType === 'ALL') return true
    if (!ctx) return false
    if (r.scopeType === 'GROUP') return r.scopeId === ctx.classSectionId
    if (r.scopeType === 'LEVEL') return r.scopeId === ctx.levelId
    if (r.scopeType === 'COURSE') return r.scopeId === ctx.subjectId
    if (r.scopeType === 'TRACK') return r.scopeId === ctx.trackId
    return false
  })
  matches.sort((a, b) => SPECIFICITY.indexOf(a.scopeType) - SPECIFICITY.indexOf(b.scopeType))
  const r = matches[0]
  if (!r) return DEFAULT_REFUND_RULE
  return {
    id: r.id,
    scopeType: r.scopeType,
    allowed: r.allowed,
    adminFeeType: r.adminFeeType === 'PERCENT' ? 'PERCENT' : 'FIXED',
    adminFeeValue: Number(r.adminFeeValue),
    deductBasis: r.deductBasis === 'HELD' ? 'HELD' : 'ATTENDED',
  }
}

// ── suggestion (pure maths kept separate for tests) ─────────────────────────
export interface RefundCalcInput {
  netPaid: number
  invoiceTotal: number
  sessionsInCycle: number | null
  sessionsCounted: number
  rule: Pick<ResolvedRule, 'adminFeeType' | 'adminFeeValue'>
}
export interface RefundCalc {
  netPaid: number
  perSession: number
  sessionsCounted: number
  deduction: number
  adminFee: number
  suggested: number
}

/** paid - (sessions x price per session) - admin fee, never below zero. */
export function computeRefundSuggestion(i: RefundCalcInput): RefundCalc {
  const perSession = i.sessionsInCycle && i.sessionsInCycle > 0 ? round2(i.invoiceTotal / i.sessionsInCycle) : 0
  const deduction = round2(Math.min(i.netPaid, perSession * i.sessionsCounted))
  const fee = i.rule.adminFeeType === 'PERCENT' ? (i.netPaid * i.rule.adminFeeValue) / 100 : i.rule.adminFeeValue
  const adminFee = round2(Math.min(Math.max(0, fee), Math.max(0, i.netPaid - deduction)))
  return { netPaid: round2(i.netPaid), perSession, sessionsCounted: i.sessionsCounted, deduction, adminFee, suggested: round2(Math.max(0, i.netPaid - deduction - adminFee)) }
}

export interface RefundSuggestion extends RefundCalc {
  invoiceId: string
  studentId: string
  allowed: boolean
  rule: ResolvedRule
  basis: 'ATTENDED' | 'HELD'
  sessionsInCycle: number | null
  pending: number
  maxRefundable: number
}

export async function suggestRefund(invoiceId: string, db: Db = prisma): Promise<RefundSuggestion | null> {
  const inv = await db.feeInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true, studentId: true, totalAmount: true, paidAmount: true, refundedAmount: true, classSectionId: true,
      level: { select: { numberOfSessions: true, numberOfMonths: true, pricingType: true } },
    },
  })
  if (!inv) return null
  const ctx = inv.classSectionId ? await groupContext(db, inv.classSectionId) : null
  const rule = await resolveRefundRule(db, ctx)
  const netPaid = round2(Number(inv.paidAmount) - Number(inv.refundedAmount))
  const pendingAgg = await db.refund.aggregate({ where: { invoiceId, status: 'PENDING' }, _sum: { amount: true } })
  const pending = round2(Number(pendingAgg._sum.amount ?? 0))

  let sessionsCounted = 0
  const sessionsInCycle = inv.level ? sessionsPerCycle(inv.level) : null
  if (inv.classSectionId) {
    if (rule.deductBasis === 'HELD') {
      const dates = await db.enrollmentAttendanceRecord.findMany({
        where: { studentEnrollment: { classSectionId: inv.classSectionId } },
        select: { attendanceDate: true },
        distinct: ['attendanceDate'],
      })
      sessionsCounted = dates.length
    } else {
      sessionsCounted = await db.enrollmentAttendanceRecord.count({
        where: { studentEnrollment: { classSectionId: inv.classSectionId, studentId: inv.studentId }, status: { in: ['PRESENT', 'LATE'] } },
      })
    }
  }
  const calc = computeRefundSuggestion({ netPaid, invoiceTotal: Number(inv.totalAmount), sessionsInCycle, sessionsCounted, rule })
  return {
    ...calc,
    invoiceId: inv.id,
    studentId: inv.studentId,
    allowed: rule.allowed,
    rule,
    basis: rule.deductBasis,
    sessionsInCycle,
    pending,
    maxRefundable: round2(Math.max(0, netPaid - pending)),
  }
}

// ── request / approve / reject ──────────────────────────────────────────────
export const canApproveRefunds = (role: string) => checkPermission(role as never, 'refunds', 'approve')

export type RefundOutcome = { ok: true; refundId: string; status: string; refundNumber: string | null } | { ok: false; status: number; message: string }

export async function requestRefund(input: {
  invoiceId: string
  amount: number
  method: 'CASH' | 'WALLET'
  payoutMethod?: string | null
  reason?: string | null
  withdrawStudent?: boolean
  userId: string
  role: string
}): Promise<RefundOutcome> {
  const s = await suggestRefund(input.invoiceId)
  if (!s) return { ok: false, status: 404, message: 'Invoice not found' }
  if (!s.allowed) return { ok: false, status: 403, message: 'Refunds are not allowed for this group (refund rules)' }
  const amount = round2(input.amount)
  if (!(amount > 0)) return { ok: false, status: 400, message: 'The amount must be more than zero' }
  if (amount > s.maxRefundable + 0.001) return { ok: false, status: 400, message: `The most that can be refunded is ${s.maxRefundable} EGP` }
  if (input.method === 'CASH' && !input.payoutMethod) return { ok: false, status: 400, message: 'Choose how the money is given back' }

  const refund = await prisma.refund.create({
    data: {
      invoiceId: s.invoiceId,
      studentId: s.studentId,
      suggestedAmount: s.suggested,
      amount,
      method: input.method,
      payoutMethod: input.method === 'CASH' ? input.payoutMethod ?? null : null,
      reason: input.reason ?? null,
      withdrawStudent: !!input.withdrawStudent,
      calc: { netPaid: s.netPaid, perSession: s.perSession, sessionsCounted: s.sessionsCounted, basis: s.basis, deduction: s.deduction, adminFee: s.adminFee, rule: s.rule.scopeType } as Prisma.InputJsonValue,
      requestedById: input.userId,
    },
  })
  // Someone who can approve does not need to ask anyone.
  if (canApproveRefunds(input.role)) return approveRefund(refund.id, input.userId)
  await notifyRefundApprovers(refund.id, amount)
  return { ok: true, refundId: refund.id, status: 'PENDING', refundNumber: null }
}

export async function nextRefundNumber(db: Db) {
  const prefix = `TN-RFND-${new Date().getFullYear()}-`
  const rows = await db.refund.findMany({ where: { refundNumber: { startsWith: prefix } }, select: { refundNumber: true } })
  return nextInSequence(rows.map((r) => r.refundNumber!).filter(Boolean), prefix, 5)
}

export async function approveRefund(refundId: string, userId: string): Promise<RefundOutcome> {
  try {
    const out = await prisma.$transaction(async (tx) => {
      const r = await tx.refund.findUnique({ where: { id: refundId } })
      if (!r) throw new RefundError(404, 'Refund not found')
      if (r.status !== 'PENDING') throw new RefundError(409, 'This refund was already handled')
      const inv = await tx.feeInvoice.findUnique({ where: { id: r.invoiceId }, select: { paidAmount: true, refundedAmount: true, classSectionId: true } })
      if (!inv) throw new RefundError(404, 'Invoice not found')
      const amount = Number(r.amount)
      const netPaid = Number(inv.paidAmount) - Number(inv.refundedAmount)
      if (amount > netPaid + 0.001) throw new RefundError(409, 'The invoice no longer has that much paid on it')

      // Guarded update: refundedAmount must still be what we read.
      const upd = await tx.feeInvoice.updateMany({
        where: { id: r.invoiceId, refundedAmount: inv.refundedAmount },
        data: { refundedAmount: { increment: amount } },
      })
      if (upd.count !== 1) throw new RefundError(409, 'The invoice was just changed; try again')

      let refundNumber = ''
      for (let attempt = 0; ; attempt++) {
        refundNumber = await nextRefundNumber(tx)
        try {
          await tx.refund.update({ where: { id: refundId }, data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date(), refundNumber } })
          break
        } catch (err) {
          if (attempt < 4 && isUniqueConflictOn(err, 'refundNumber')) continue
          throw err
        }
      }
      if (r.method === 'WALLET') {
        await tx.walletTransaction.create({
          data: { studentId: r.studentId, amount, type: 'REFUND', refundId, note: `Refund ${refundNumber}`, createdById: userId },
        })
      }
      // Student fee summary (denormalised), never below zero.
      const st = await tx.student.findUnique({ where: { id: r.studentId }, select: { paidAmount: true } })
      await tx.student.update({ where: { id: r.studentId }, data: { paidAmount: Math.max(0, Number(st?.paidAmount ?? 0) - amount) } })
      if (r.withdrawStudent && inv.classSectionId) {
        await tx.studentEnrollment.updateMany({
          where: { studentId: r.studentId, classSectionId: inv.classSectionId, status: 'ACTIVE' },
          data: { status: 'WITHDRAWN', withdrawalReason: 'REFUND' },
        })
      }
      await tx.auditLog.create({
        data: {
          userId, action: 'UPDATE', entityType: 'Refund', entityId: refundId,
          changes: { status: 'APPROVED', refundNumber, amount, method: r.method, invoiceId: r.invoiceId, withdrawStudent: r.withdrawStudent },
        },
      })
      return { requestedById: r.requestedById, refundNumber, withdrewFrom: r.withdrawStudent && inv.classSectionId ? inv.classSectionId : null }
    })
    if (out.requestedById !== userId) await notifyUser(out.requestedById, 'Refund approved', `Refund ${out.refundNumber} was approved`, refundId)
    if (out.withdrewFrom) await notifySeatFreed(out.withdrewFrom)
    return { ok: true, refundId, status: 'APPROVED', refundNumber: out.refundNumber }
  } catch (err) {
    if (err instanceof RefundError) return { ok: false, status: err.status, message: err.message }
    throw err
  }
}

export async function rejectRefund(refundId: string, userId: string, reason?: string | null): Promise<RefundOutcome> {
  const r = await prisma.refund.findUnique({ where: { id: refundId } })
  if (!r) return { ok: false, status: 404, message: 'Refund not found' }
  if (r.status !== 'PENDING') return { ok: false, status: 409, message: 'This refund was already handled' }
  await prisma.refund.update({ where: { id: refundId }, data: { status: 'REJECTED', approvedById: userId, approvedAt: new Date(), rejectedReason: reason ?? null } })
  await prisma.auditLog.create({ data: { userId, action: 'UPDATE', entityType: 'Refund', entityId: refundId, changes: { status: 'REJECTED', reason } } })
  if (r.requestedById !== userId) await notifyUser(r.requestedById, 'Refund rejected', reason ?? '', refundId)
  return { ok: true, refundId, status: 'REJECTED', refundNumber: null }
}

class RefundError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

// ── wallet ──────────────────────────────────────────────────────────────────
export async function walletBalance(studentId: string, db: Db = prisma): Promise<number> {
  const agg = await db.walletTransaction.aggregate({ where: { studentId }, _sum: { amount: true } })
  return round2(Number(agg._sum.amount ?? 0))
}

export const WALLET_METHOD = 'Wallet'

/** Pays an invoice from the student's wallet (all of the balance needed, or `amount`). */
export async function payFromWallet(invoiceId: string, userId: string, amount?: number, opts: { remarks?: string; allowPartial?: boolean } = {}) {
  const inv = await prisma.feeInvoice.findUnique({ where: { id: invoiceId }, select: { studentId: true, totalAmount: true, paidAmount: true } })
  if (!inv) return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Invoice not found' }
  const balance = await walletBalance(inv.studentId)
  const remaining = round2(Number(inv.totalAmount) - Number(inv.paidAmount))
  const toPay = round2(Math.min(amount ?? remaining, remaining, balance))
  if (!(toPay > 0)) return { ok: false as const, code: 'REFUSED' as const, message: 'The wallet is empty' }
  return recordPayment({
    invoiceId,
    amount: toPay,
    method: WALLET_METHOD,
    source: 'WALLET',
    receivedBy: userId,
    remarks: opts.remarks ?? 'Paid from the student wallet',
    allowPartial: opts.allowPartial,
    onTx: async (tx, payment) => {
      // Check again inside the transaction, then take the money out of the wallet.
      const now = await walletBalance(inv.studentId, tx)
      if (now + 0.001 < payment.amount) throw new PaymentRefusedError('Not enough money in the wallet')
      await tx.walletTransaction.create({
        data: { studentId: inv.studentId, amount: -payment.amount, type: 'PAYMENT', paymentId: payment.id, note: 'Invoice payment', createdById: userId },
      })
    },
  })
}

// ── notifications (never break the main action) ─────────────────────────────
const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SECRETARY'] as const
async function notifyRefundApprovers(refundId: string, amount: number) {
  try {
    const roles = STAFF_ROLES.filter((r) => canApproveRefunds(r))
    const users = await prisma.user.findMany({ where: { role: { in: [...roles] }, isActive: true }, select: { id: true } })
    if (users.length) {
      await prisma.notification.createMany({
        data: users.map((u) => ({ userId: u.id, title: 'Refund request', message: `A refund of ${amount} EGP is waiting for approval`, type: 'REFUND_REQUEST', relatedId: refundId })),
      })
    }
  } catch (err) {
    console.error('[REFUND_NOTIFY]', err)
  }
}
async function notifyUser(userId: string, title: string, message: string, relatedId: string) {
  try {
    await prisma.notification.create({ data: { userId, title, message, type: 'REFUND_REQUEST', relatedId } })
  } catch (err) {
    console.error('[REFUND_NOTIFY]', err)
  }
}
