/**
 * Cancel a payment recorded by mistake (2026-11-07, owner). Server-only. Pure rules: ./void-rules.ts.
 *   requestVoid  → PENDING (reason required); approvers are told (event PAYMENT_VOID_REQUEST)
 *   approveVoid  → another person (payment_voids:approve) — one transaction:
 *                  payment VOIDED, invoice paid / status back, student summary back, the payment's wallet lines removed
 *                  (a wallet payment gives the money back to the wallet; a normal one had +x and −x, both go) and its
 *                  "through the wallet" top-up marked VOIDED, its cash-box movement removed.
 *                  Then: group overdue check, the family is told (PAYMENT_VOIDED, can be switched off), Super Admins alerted.
 *   rejectVoid   → REJECTED (requester told)
 * A closed month refuses it on its own (the payment row is guarded by lib/month-close/guard.ts).
 * Online payments are never voided (the money reached the gateway): refund them.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { refreshGroupAfterPayment } from '@/lib/fees/guarded-payment'
import { notifyFamilies, notifyUsers } from '@/lib/notifications/events'
import { securityAlert } from '@/lib/security/alerts'
import { canDecide, cleanVoidSettings, DEFAULT_VOID_SETTINGS, invoiceAfterVoid, studentAfterVoid, VOID_PROBLEM_TEXT, voidProblem, type VoidSettings } from './void-rules'

const KEY = 'payments.void'
export const getVoidSettings = async () => cleanVoidSettings(await getSetting<Partial<VoidSettings>>(KEY, DEFAULT_VOID_SETTINGS))
export async function saveVoidSettings(v: Partial<VoidSettings>, userId: string) {
  const next = cleanVoidSettings({ ...(await getVoidSettings()), ...v })
  await setSetting(KEY, next, userId)
  return next
}

export type VoidOutcome = { ok: true; id: string; state: string; status?: undefined; message?: undefined; code?: undefined } | { ok: false; status: number; message: string; code?: string }
const fail = (status: number, message: string, code?: string): VoidOutcome => ({ ok: false, status, message, code })
const num = (x: unknown) => Number(x ?? 0)
const egp = (n: number) => `${n.toLocaleString('en-US')} EGP`

/** Why this payment cannot be voided now (null = it can). */
async function problemOf(paymentId: string, db: Prisma.TransactionClient | typeof prisma = prisma, opts: { ignoreAge?: boolean } = {}) {
  const p = await db.feePayment.findUnique({ where: { id: paymentId }, select: { id: true, status: true, source: true, createdAt: true, amount: true, invoiceId: true, studentId: true, receiptNumber: true, invoice: { select: { paidAmount: true, refundedAmount: true } } } })
  if (!p) return { p: null, problem: null }
  const mv = await db.moneyMovement.findUnique({ where: { feePaymentId: p.id }, select: { reconciledAt: true } })
  const problem = voidProblem({
    settings: await getVoidSettings(), status: p.status, source: p.source, createdAt: opts.ignoreAge ? new Date() : p.createdAt, now: new Date(),
    amount: num(p.amount), invoicePaid: num(p.invoice.paidAmount), invoiceRefunded: num(p.invoice.refundedAmount), reconciled: !!mv?.reconciledAt,
  })
  return { p, problem }
}
const problemText = (k: keyof typeof VOID_PROBLEM_TEXT) => `${VOID_PROBLEM_TEXT[k].en} · ${VOID_PROBLEM_TEXT[k].ar}`

/** Can this payment be voided? (for the button). */
export async function voidCheck(paymentId: string) {
  const { p, problem } = await problemOf(paymentId)
  if (!p) return null
  const pending = await prisma.paymentVoid.findFirst({ where: { paymentId, status: 'PENDING' }, select: { id: true } })
  return { possible: !problem && !pending, problem: problem ? VOID_PROBLEM_TEXT[problem] : null, pendingId: pending?.id ?? null }
}

export async function requestVoid(paymentId: string, userId: string, reason: string): Promise<VoidOutcome> {
  const why = reason.trim()
  if (why.length < 5) return fail(400, 'Write the reason (at least 5 letters) · اكتب السبب')
  const { p, problem } = await problemOf(paymentId)
  if (!p) return fail(404, 'Payment not found')
  if (problem) return fail(409, problemText(problem), problem)
  if (await prisma.paymentVoid.findFirst({ where: { paymentId, status: 'PENDING' }, select: { id: true } })) return fail(409, 'A cancel request for this payment is already waiting · فيه طلب إلغاء مستني بالفعل', 'PENDING')
  const v = await prisma.paymentVoid.create({ data: { paymentId, invoiceId: p.invoiceId, studentId: p.studentId, amount: p.amount, receiptNumber: p.receiptNumber, reason: why.slice(0, 1000), requestedById: userId } })
  await notifyApprovers(v.id, num(p.amount), p.receiptNumber, userId)
  return { ok: true, id: v.id, state: v.status }
}

async function notifyApprovers(voidId: string, amount: number, receipt: string | null, requesterId: string) {
  try {
    const roles = (['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SECRETARY'] as const).filter((r) => checkPermission(r, 'payment_voids', 'approve'))
    const users = await prisma.user.findMany({ where: { role: { in: [...roles] }, isActive: true, id: { not: requesterId } }, select: { id: true } })
    await notifyUsers(users.map((u) => u.id), 'PAYMENT_VOID_REQUEST', {
      title: 'Payment to cancel', message: `Cancel request for receipt ${receipt ?? ''} (${egp(amount)}) is waiting for approval`,
      titleAr: 'طلب إلغاء دفعة', messageAr: `طلب إلغاء الإيصال ${receipt ?? ''} (${amount} ج.م) مستني الموافقة`, relatedId: voidId,
    })
  } catch (err) { console.error('[VOID_NOTIFY]', err) }
}

export async function approveVoid(voidId: string, user: { id: string; role: string }, note?: string | null): Promise<VoidOutcome> {
  const v = await prisma.paymentVoid.findUnique({ where: { id: voidId } })
  if (!v) return fail(404, 'Request not found')
  if (v.status !== 'PENDING') return fail(409, 'This request was already decided · الطلب ده اتقرر قبل كده')
  const who = canDecide({ canApprove: checkPermission(user.role as never, 'payment_voids', 'approve'), userId: user.id, requestedById: v.requestedById })
  if (who === 'ROLE') return fail(403, 'You cannot approve cancelling payments · مش من صلاحيتك')
  if (who === 'OWN') return fail(403, 'Another person must approve your own request · لازم حد تاني غيرك يوافق على طلبك', 'OWN_REQUEST')

  let classSectionId: string | null = null
  try {
    await prisma.$transaction(async (tx) => {
      // the age was checked when the request was made, not again at approval
      const { p, problem } = await problemOf(v.paymentId, tx, { ignoreAge: true })
      if (!p) throw new VoidRefused('Payment not found')
      if (problem) throw new VoidRefused(problemText(problem))
      const amount = num(p.amount)
      const done = await tx.feePayment.updateMany({ where: { id: p.id, status: 'COMPLETED' }, data: { status: 'VOIDED', voidedAt: new Date() } })
      if (done.count !== 1) throw new VoidRefused(problemText('NOT_COMPLETED'))

      const inv = await tx.feeInvoice.findUniqueOrThrow({ where: { id: p.invoiceId }, select: { id: true, totalAmount: true, paidAmount: true, dueDate: true, classSectionId: true } })
      classSectionId = inv.classSectionId
      const after = invoiceAfterVoid({ total: num(inv.totalAmount), paid: num(inv.paidAmount), amount, dueDate: inv.dueDate, now: new Date() })
      const changed = await tx.feeInvoice.updateMany({ where: { id: inv.id, paidAmount: inv.paidAmount }, data: { paidAmount: after.paid, status: after.status } })
      if (changed.count !== 1) throw new VoidRefused('The invoice was just changed. Try again · الفاتورة اتغيرت دلوقتي، جرّب تاني')

      const st = await tx.student.findUniqueOrThrow({ where: { id: p.studentId }, select: { paidAmount: true, dueAmount: true } })
      const s = studentAfterVoid({ paid: num(st.paidAmount), due: num(st.dueAmount), amount })
      await tx.student.update({ where: { id: p.studentId }, data: { paidAmount: s.paid, dueAmount: s.due, feeStatus: s.feeStatus } })

      // wallet: the payment's own lines go (wallet payment → its money is back in the wallet; normal payment → +x and −x both go)
      const lines = await tx.walletTransaction.findMany({ where: { paymentId: p.id }, select: { id: true, topUpId: true } })
      await tx.walletTransaction.deleteMany({ where: { id: { in: lines.map((l) => l.id) } } })
      const topUpIds = lines.map((l) => l.topUpId).filter((x): x is string => !!x)
      await tx.walletTopUp.updateMany({ where: { OR: [{ paymentId: p.id }, { id: { in: topUpIds } }], source: 'PAYMENT' }, data: { status: 'VOIDED' } })
      await tx.walletTransaction.deleteMany({ where: { topUpId: { in: topUpIds }, type: 'TOPUP' } })

      // cash box / bank: the movement made from this payment goes (none yet = nothing to do; the sync skips VOIDED)
      await tx.moneyMovement.deleteMany({ where: { feePaymentId: p.id } })

      await tx.paymentVoid.update({ where: { id: v.id }, data: { status: 'APPROVED', decidedById: user.id, decidedAt: new Date(), decisionNote: note?.trim() || null } })
      await tx.auditLog.create({ data: { userId: user.id, action: 'UPDATE', entityType: 'FeePayment', entityId: p.id, changes: { voided: true, voidId: v.id, receiptNumber: p.receiptNumber, amount, reason: v.reason, requestedById: v.requestedById, invoiceStatus: after.status } as Prisma.InputJsonValue } })
    })
  } catch (err) {
    if (err instanceof VoidRefused) return fail(409, err.message)
    throw err
  }

  await refreshGroupAfterPayment(classSectionId, user.id)
  const amount = num(v.amount)
  await notifyUsers([v.requestedById], 'PAYMENT_VOID_REQUEST', { title: 'Payment cancelled', message: `Receipt ${v.receiptNumber ?? ''} was cancelled`, titleAr: 'الدفعة اتلغت', messageAr: `الإيصال ${v.receiptNumber ?? ''} اتلغى بعد الموافقة`, relatedId: v.id })
  await notifyFamilies([v.studentId], 'PAYMENT_VOIDED', (s) => ({
    title: 'A receipt was cancelled', message: `Receipt ${v.receiptNumber ?? ''} (${egp(amount)}) for ${s.firstName} was recorded by mistake and is cancelled. The invoice is due again.`,
    titleAr: 'إيصال اتلغى', messageAr: `الإيصال ${v.receiptNumber ?? ''} (${amount} ج.م) لـ ${s.firstName} اتسجل بالغلط واتلغى، والفاتورة رجعت مستحقة.`, relatedId: v.invoiceId,
  }))
  await securityAlert('PAYMENT_VOID', { actorId: user.id, text: `Receipt ${v.receiptNumber ?? ''} (${egp(amount)}) was cancelled. Reason: ${v.reason}`.slice(0, 300), textAr: `الإيصال ${v.receiptNumber ?? ''} (${amount} ج.م) اتلغى. السبب: ${v.reason}`.slice(0, 300) })
  return { ok: true, id: v.id, state: 'APPROVED' }
}

export async function rejectVoid(voidId: string, user: { id: string; role: string }, note?: string | null): Promise<VoidOutcome> {
  const v = await prisma.paymentVoid.findUnique({ where: { id: voidId } })
  if (!v) return fail(404, 'Request not found')
  if (v.status !== 'PENDING') return fail(409, 'This request was already decided · الطلب ده اتقرر قبل كده')
  // the person who asked may withdraw it; otherwise an approver
  if (v.requestedById !== user.id && !checkPermission(user.role as never, 'payment_voids', 'approve')) return fail(403, 'You cannot decide this request')
  await prisma.paymentVoid.update({ where: { id: v.id }, data: { status: 'REJECTED', decidedById: user.id, decidedAt: new Date(), decisionNote: note?.trim() || null } })
  if (v.requestedById !== user.id) await notifyUsers([v.requestedById], 'PAYMENT_VOID_REQUEST', { title: 'Cancel request refused', message: note?.trim() || `Receipt ${v.receiptNumber ?? ''} stays`, titleAr: 'طلب إلغاء الدفعة اترفض', messageAr: note?.trim() || `الإيصال ${v.receiptNumber ?? ''} فاضل زي ما هو`, relatedId: v.id })
  return { ok: true, id: v.id, state: 'REJECTED' }
}

class VoidRefused extends Error {}
