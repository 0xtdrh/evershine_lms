/**
 * Wallet-first payments (phase B, docs/design-phase-b.md). Server-only.
 *
 *  - every payment passes through the wallet (recordPayment adds the top-up +
 *    payment pair); free top-ups: staff (cash / transfer at the branch, at
 *    once), parent proof upload (after approval), Paymob online (fee on top)
 *  - after a top-up and when a new invoice is created, open invoices are paid
 *    from the wallet automatically, oldest first; partly only when the group
 *    allows installments; refunded invoices and groups the student left are skipped
 *  - minimum top-up per scope (largest of the student's active groups)
 *  - withdrawals: allowed per scope, need approval, fee by payout method
 *  - sibling transfers (same parent), top-up promos (bonus = discount on the
 *    next invoice), low-balance alerts
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { isUniqueConflictOn } from '@/lib/ids/sequence'
import { payFromWallet, walletBalance } from '@/lib/refunds/engine'
import { logSystemContact } from '@/lib/contacts/contact-log'
import { createApprovedTopUp, nextWithdrawalNumber } from './numbers'

type Db = Prisma.TransactionClient | typeof prisma
const round2 = (n: number) => Math.round(n * 100) / 100
export { walletBalance }

// ── settings ────────────────────────────────────────────────────────────────
export interface TopUpPromo { id: string; minAmount: number; bonus: number; from: string | null; to: string | null; active: boolean }
export interface WalletSettings {
  /** Paymob fee paid by the parent, added on top: percent of the amount + fixed */
  paymobFeePercent: number
  paymobFeeFixed: number
  /** withdrawal fee per payout method name */
  withdrawFees: Record<string, { type: 'FIXED' | 'PERCENT'; value: number }>
  /** low-balance alert this many days before a month ends */
  lowBalanceDays: number
  promos: TopUpPromo[]
}
export const WALLET_DEFAULTS: WalletSettings = { paymobFeePercent: 0, paymobFeeFixed: 0, withdrawFees: {}, lowBalanceDays: 3, promos: [] }
export const getWalletSettings = () => getSetting<WalletSettings>('wallet.settings', WALLET_DEFAULTS)
export const saveWalletSettings = (v: WalletSettings, userId: string) => setSetting('wallet.settings', v, userId)

export function paymobFee(amount: number, s: Pick<WalletSettings, 'paymobFeePercent' | 'paymobFeeFixed'>) {
  if (!(amount > 0)) return 0
  return round2((amount * Math.max(0, s.paymobFeePercent || 0)) / 100 + Math.max(0, s.paymobFeeFixed || 0))
}

export function withdrawFee(amount: number, method: string, s: Pick<WalletSettings, 'withdrawFees'>) {
  const f = s.withdrawFees?.[method]
  if (!f || !(amount > 0)) return 0
  const v = f.type === 'PERCENT' ? (amount * f.value) / 100 : f.value
  return round2(Math.min(amount, Math.max(0, v)))
}

// ── rules (minimum top-up, withdrawals) ─────────────────────────────────────
const SPECIFICITY = ['GROUP', 'LEVEL', 'COURSE', 'TRACK', 'ALL']
interface Ctx { groupId: string; levelId: string | null; subjectId: string | null; trackId: string | null }

async function activeContexts(studentId: string, db: Db = prisma): Promise<Ctx[]> {
  const rows = await db.studentEnrollment.findMany({
    where: { studentId, status: 'ACTIVE', classSection: { status: 'ACTIVE' } },
    select: { classSection: { select: { id: true, levelId: true, level: { select: { subjectId: true, subject: { select: { trackId: true } } } } } } },
  })
  return rows.map((r) => ({ groupId: r.classSection.id, levelId: r.classSection.levelId, subjectId: r.classSection.level?.subjectId ?? null, trackId: r.classSection.level?.subject?.trackId ?? null }))
}

type Rule = { scopeType: string; scopeId: string | null; minAmount: Prisma.Decimal | null; allowed: boolean }
function bestRule(rules: Rule[], ctx: Ctx | null): Rule | null {
  const m = rules.filter((r) => {
    if (r.scopeType === 'ALL') return true
    if (!ctx) return false
    if (r.scopeType === 'GROUP') return r.scopeId === ctx.groupId
    if (r.scopeType === 'LEVEL') return r.scopeId === ctx.levelId
    if (r.scopeType === 'COURSE') return r.scopeId === ctx.subjectId
    if (r.scopeType === 'TRACK') return r.scopeId === ctx.trackId
    return false
  })
  m.sort((a, b) => SPECIFICITY.indexOf(a.scopeType) - SPECIFICITY.indexOf(b.scopeType))
  return m[0] ?? null
}

/** Minimum free top-up for a student: the largest of their active groups' rules (owner). */
export async function minimumTopUp(studentId: string): Promise<number> {
  const rules = await prisma.walletRule.findMany({ where: { kind: 'MIN_TOPUP' } })
  if (!rules.length) return 0
  const ctxs = await activeContexts(studentId)
  const values = (ctxs.length ? ctxs : [null]).map((c) => Number(bestRule(rules, c)?.minAmount ?? 0))
  return Math.max(0, ...values)
}

/** Withdrawals: allowed only if every active group's rule allows (no rule = allowed). */
export async function withdrawalAllowed(studentId: string): Promise<boolean> {
  const rules = await prisma.walletRule.findMany({ where: { kind: 'WITHDRAW' } })
  if (!rules.length) return true
  const ctxs = await activeContexts(studentId)
  return (ctxs.length ? ctxs : [null]).every((c) => bestRule(rules, c)?.allowed ?? true)
}

// ── automatic payment from the wallet ───────────────────────────────────────
/**
 * Pays the student's open invoices from the wallet: `preferInvoiceId` first,
 * then the oldest. Stops at the first invoice that cannot be paid (strict
 * oldest-first). Never throws.
 */
export async function autoPay(studentId: string, opts: { userId: string; preferInvoiceId?: string | null }) {
  const paid: { invoiceId: string; paymentId: string; amount: number; receiptNumber: string }[] = []
  try {
    const invoices = await prisma.feeInvoice.findMany({
      where: { studentId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] }, refundedAmount: 0 },
      select: { id: true, totalAmount: true, paidAmount: true, classSectionId: true, dueDate: true, createdAt: true, classSection: { select: { installmentsAllowed: true } } },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    })
    // Skip invoices of groups the student is no longer in.
    const active = new Set((await prisma.studentEnrollment.findMany({ where: { studentId, status: 'ACTIVE' }, select: { classSectionId: true } })).map((e) => e.classSectionId))
    const list = invoices.filter((i) => !i.classSectionId || active.has(i.classSectionId))
    list.sort((a, b) => (a.id === opts.preferInvoiceId ? -1 : b.id === opts.preferInvoiceId ? 1 : 0))
    for (const inv of list) {
      const balance = await walletBalance(studentId)
      if (balance <= 0.001) break
      const remaining = round2(Number(inv.totalAmount) - Number(inv.paidAmount))
      if (remaining <= 0) continue
      const partialOk = !inv.classSectionId || !!inv.classSection?.installmentsAllowed
      if (balance + 0.001 < remaining && !partialOk) break
      const amount = round2(Math.min(balance, remaining))
      const r = await payFromWallet(inv.id, opts.userId, amount, { remarks: 'Paid automatically from the wallet', allowPartial: true })
      if (!('payment' in r)) break
      paid.push({ invoiceId: inv.id, paymentId: r.payment.id, amount: r.amount, receiptNumber: r.receiptNumber })
    }
  } catch (err) {
    console.error('[WALLET_AUTOPAY]', err)
  }
  if (paid.length) await notifyAutoPaid(studentId, paid)
  return paid
}

/** Tells the parents that the wallet paid an invoice (type WALLET_PAYMENT, relatedId = paymentId → receipt link). Never throws. */
async function notifyAutoPaid(studentId: string, paid: { invoiceId: string; paymentId: string; amount: number; receiptNumber: string }[]) {
  try {
    const { isEventOn } = await import('@/lib/notifications/events')
    if (!(await isEventOn('WALLET_PAYMENT'))) return
    const s = await prisma.student.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true, guardians: { select: { userId: true } } } })
    if (!s?.guardians.length) return
    const invoices = await prisma.feeInvoice.findMany({ where: { id: { in: paid.map((p) => p.invoiceId) } }, select: { id: true, challanNumber: true, status: true, totalAmount: true, paidAmount: true } })
    const byId = new Map(invoices.map((i) => [i.id, i]))
    const balance = await walletBalance(studentId)
    const name = `${s.firstName} ${s.lastName}`.trim()
    const rows = paid.flatMap((p) => {
      const inv = byId.get(p.invoiceId)
      const left = inv ? round2(Number(inv.totalAmount) - Number(inv.paidAmount)) : 0
      const message = `${p.amount} EGP was paid from ${name}'s wallet for invoice ${inv?.challanNumber ?? ''}${left > 0 ? ` (${left} EGP still due)` : ' (fully paid)'}. Receipt ${p.receiptNumber}. Wallet balance now ${balance} EGP.`
      return s.guardians.map((g) => ({ userId: g.userId, title: 'Invoice paid from the wallet', message, type: 'WALLET_PAYMENT', relatedId: p.paymentId }))
    })
    await prisma.notification.createMany({ data: rows })
  } catch (err) {
    console.error('[WALLET_NOTIFY_AUTOPAY]', err)
  }
}

// ── top-ups ─────────────────────────────────────────────────────────────────
export type WalletOutcome<T> = ({ ok: true } & T) | { ok: false; status: number; message: string }

async function applyPromo(studentId: string, amount: number, userId: string) {
  try {
    const s = await getWalletSettings()
    const today = new Date().toISOString().slice(0, 10)
    const promo = (s.promos ?? [])
      .filter((p) => p.active && amount + 0.001 >= p.minAmount && (!p.from || p.from <= today) && (!p.to || p.to >= today))
      .sort((a, b) => b.bonus - a.bonus)[0]
    if (!promo || !(promo.bonus > 0)) return null
    let type = await prisma.discountType.findFirst({ where: { name: 'Top-up bonus', kind: 'PROMO' } })
    if (!type) {
      type = await prisma.discountType.create({
        data: { name: 'Top-up bonus', kind: 'PROMO', valueType: 'FIXED', value: 0, editableValue: true, duration: 'ONE_TIME', autoApply: false, approvalMode: 'STAFF', scopeType: 'ALL', stackable: true, createdById: userId },
      })
    }
    await prisma.discountAssignment.create({
      data: { discountTypeId: type.id, studentId, value: promo.bonus, status: 'ACTIVE', reason: `Top-up bonus: topped up ${amount} EGP (offer ${promo.minAmount}+)`, requestedById: userId, approvedById: userId, approvedAt: new Date() },
    })
    return promo.bonus
  } catch (err) {
    console.error('[WALLET_PROMO]', err)
    return null
  }
}

async function afterTopUp(studentId: string, topUpId: string, amount: number, userId: string, opts: { promo: boolean; preferInvoiceId?: string | null }) {
  const bonus = opts.promo ? await applyPromo(studentId, amount, userId) : null
  const payments = await autoPay(studentId, { userId, preferInvoiceId: opts.preferInvoiceId })
  const t = await prisma.walletTopUp.findUnique({ where: { id: topUpId }, select: { topUpNumber: true } })
  await logSystemContact({ studentId, channel: 'SYSTEM', direction: 'IN', reason: 'PAYMENT', summary: `Wallet top-up ${t?.topUpNumber ?? ''}: ${amount} EGP${payments.length ? `, paid ${payments.length} invoice(s) automatically` : ''}.` })
  return { bonus, payments, balance: await walletBalance(studentId) }
}

/** Staff top-up at the branch (cash / transfer): balance at once, then automatic payments. */
export async function staffTopUp(input: { studentId: string; amount: number; method: string; transactionId?: string | null; remarks?: string | null; userId: string }): Promise<WalletOutcome<{ topUpId: string; topUpNumber: string | null; bonus: number | null; payments: Awaited<ReturnType<typeof autoPay>>; balance: number }>> {
  const amount = round2(input.amount)
  if (!(amount > 0)) return { ok: false, status: 400, message: 'The amount must be more than zero' }
  const min = await minimumTopUp(input.studentId)
  if (amount + 0.001 < min) return { ok: false, status: 400, message: `The minimum top-up for this student is ${min} EGP` }
  const student = await prisma.student.findUnique({ where: { id: input.studentId }, select: { id: true } })
  if (!student) return { ok: false, status: 404, message: 'Student not found' }
  const row = await prisma.$transaction((tx) => createApprovedTopUp(tx, { studentId: input.studentId, amount, method: input.method, source: 'STAFF', transactionId: input.transactionId, remarks: input.remarks, userId: input.userId }))
  const after = await afterTopUp(input.studentId, row.id, amount, input.userId, { promo: true })
  return { ok: true, topUpId: row.id, topUpNumber: row.topUpNumber, ...after }
}

/** Parent uploaded a transfer receipt: waits for approval. */
export async function requestProofTopUp(input: { studentId: string; amount: number; proofUrl: string; remarks?: string | null; userId: string }): Promise<WalletOutcome<{ topUpId: string }>> {
  const amount = round2(input.amount)
  if (!(amount > 0)) return { ok: false, status: 400, message: 'The amount must be more than zero' }
  const min = await minimumTopUp(input.studentId)
  if (amount + 0.001 < min) return { ok: false, status: 400, message: `The minimum top-up is ${min} EGP` }
  const row = await prisma.walletTopUp.create({
    data: { studentId: input.studentId, amount, method: 'Bank Transfer', source: 'PROOF', status: 'PENDING', proofUrl: input.proofUrl, remarks: input.remarks ?? null, createdById: input.userId },
  })
  await notifyApprovers('Wallet top-up to check', `A parent uploaded a transfer receipt for ${amount} EGP`, row.id)
  return { ok: true, topUpId: row.id }
}

export async function approveTopUp(topUpId: string, userId: string): Promise<WalletOutcome<{ topUpNumber: string | null; payments: Awaited<ReturnType<typeof autoPay>>; balance: number }>> {
  const t = await prisma.walletTopUp.findUnique({ where: { id: topUpId } })
  if (!t) return { ok: false, status: 404, message: 'Top-up not found' }
  if (t.status !== 'PENDING') return { ok: false, status: 409, message: 'This top-up was already handled' }
  let number: string | null = null
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.walletTopUp.updateMany({ where: { id: topUpId, status: 'PENDING' }, data: { status: 'APPROVING' } })
      if (claimed.count !== 1) throw new Error('HANDLED')
      for (let attempt = 0; ; attempt++) {
        const { nextTopUpNumber } = await import('./numbers')
        number = await nextTopUpNumber(tx)
        try {
          await tx.walletTopUp.update({ where: { id: topUpId }, data: { status: 'APPROVED', topUpNumber: number, approvedById: userId, approvedAt: new Date() } })
          break
        } catch (err) {
          if (attempt < 4 && isUniqueConflictOn(err, 'topUpNumber')) continue
          throw err
        }
      }
      await tx.walletTransaction.create({ data: { studentId: t.studentId, amount: Number(t.amount), type: 'TOPUP', topUpId, note: `Top-up ${number}`, createdById: userId } })
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'HANDLED') return { ok: false, status: 409, message: 'This top-up was already handled' }
    throw err
  }
  const after = await afterTopUp(t.studentId, topUpId, Number(t.amount), userId, { promo: true, preferInvoiceId: t.invoiceId })
  await notifyParents(t.studentId, 'Top-up approved', `Your top-up of ${Number(t.amount)} EGP (${number}) was added to the wallet.`, topUpId)
  return { ok: true, topUpNumber: number, payments: after.payments, balance: after.balance }
}

export async function rejectTopUp(topUpId: string, userId: string, reason?: string | null): Promise<WalletOutcome<object>> {
  const t = await prisma.walletTopUp.findUnique({ where: { id: topUpId } })
  if (!t) return { ok: false, status: 404, message: 'Top-up not found' }
  if (t.status !== 'PENDING') return { ok: false, status: 409, message: 'This top-up was already handled' }
  await prisma.walletTopUp.update({ where: { id: topUpId }, data: { status: 'REJECTED', rejectedReason: reason ?? null, approvedById: userId, approvedAt: new Date() } })
  await notifyParents(t.studentId, 'Top-up not accepted', `Your top-up of ${Number(t.amount)} EGP was not accepted${reason ? `: ${reason}` : ''}.`, topUpId)
  return { ok: true }
}

/** Paymob callback for a wallet top-up (kind TOPUP), already verified. */
export async function onlineTopUpPaid(online: { id: string; studentId: string; amount: Prisma.Decimal; fee: Prisma.Decimal; createdById: string }, txnId: string) {
  const row = await prisma.$transaction((tx) =>
    createApprovedTopUp(tx, { studentId: online.studentId, amount: Number(online.amount), fee: Number(online.fee), method: 'Online (Paymob)', source: 'ONLINE', transactionId: txnId, userId: online.createdById })
  )
  await prisma.onlinePayment.update({ where: { id: online.id }, data: { status: 'PAID', providerTxnId: txnId, topUpId: row.id } })
  const after = await afterTopUp(online.studentId, row.id, Number(online.amount), online.createdById, { promo: true })
  return { topUpId: row.id, topUpNumber: row.topUpNumber, ...after }
}

// ── sibling transfers ───────────────────────────────────────────────────────
export async function siblingsOf(studentId: string): Promise<string[]> {
  const s = await prisma.student.findUnique({ where: { id: studentId }, select: { guardians: { select: { students: { select: { id: true } } } } } })
  return [...new Set((s?.guardians ?? []).flatMap((g) => g.students.map((x) => x.id)))].filter((id) => id !== studentId)
}

export async function transferBetweenSiblings(input: { fromId: string; toId: string; amount: number; userId: string }): Promise<WalletOutcome<{ payments: Awaited<ReturnType<typeof autoPay>> }>> {
  const amount = round2(input.amount)
  if (!(amount > 0)) return { ok: false, status: 400, message: 'The amount must be more than zero' }
  if (!(await siblingsOf(input.fromId)).includes(input.toId)) return { ok: false, status: 400, message: 'Transfers are only between brothers and sisters (same parent)' }
  try {
    await prisma.$transaction(async (tx) => {
      const bal = await walletBalance(input.fromId, tx)
      if (bal + 0.001 < amount) throw new Error(`NOT_ENOUGH:${bal}`)
      await tx.walletTransaction.create({ data: { studentId: input.fromId, amount: -amount, type: 'TRANSFER_OUT', otherStudentId: input.toId, note: 'Transfer to a sibling', createdById: input.userId } })
      await tx.walletTransaction.create({ data: { studentId: input.toId, amount, type: 'TRANSFER_IN', otherStudentId: input.fromId, note: 'Transfer from a sibling', createdById: input.userId } })
    })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('NOT_ENOUGH:')) return { ok: false, status: 400, message: `Not enough in the wallet (${err.message.split(':')[1]} EGP)` }
    throw err
  }
  const payments = await autoPay(input.toId, { userId: input.userId })
  return { ok: true, payments }
}

// ── withdrawals ─────────────────────────────────────────────────────────────
export async function requestWithdrawal(input: { studentId: string; amount: number; payoutMethod: string; reason?: string | null; via: 'PARENT' | 'STAFF'; userId: string }): Promise<WalletOutcome<{ withdrawalId: string; fee: number }>> {
  const amount = round2(input.amount)
  if (!(amount > 0)) return { ok: false, status: 400, message: 'The amount must be more than zero' }
  if (!(await withdrawalAllowed(input.studentId))) return { ok: false, status: 403, message: 'Withdrawing from the wallet is not allowed for this student (wallet rules)' }
  const bal = await walletBalance(input.studentId)
  const pending = await prisma.walletWithdrawal.aggregate({ where: { studentId: input.studentId, status: 'PENDING' }, _sum: { amount: true } })
  const free = round2(bal - Number(pending._sum.amount ?? 0))
  if (amount > free + 0.001) return { ok: false, status: 400, message: `The most that can be withdrawn is ${free} EGP` }
  const fee = withdrawFee(amount, input.payoutMethod, await getWalletSettings())
  const row = await prisma.walletWithdrawal.create({
    data: { studentId: input.studentId, amount, fee, payoutMethod: input.payoutMethod, reason: input.reason ?? null, requestedVia: input.via, requestedById: input.userId },
  })
  await notifyApprovers('Wallet withdrawal request', `${amount} EGP to be paid back by ${input.payoutMethod} (fee ${fee})`, row.id)
  return { ok: true, withdrawalId: row.id, fee }
}

export async function decideWithdrawal(id: string, userId: string, approve: boolean, reason?: string | null): Promise<WalletOutcome<{ withdrawalNumber: string | null }>> {
  const w = await prisma.walletWithdrawal.findUnique({ where: { id } })
  if (!w) return { ok: false, status: 404, message: 'Request not found' }
  if (w.status !== 'PENDING') return { ok: false, status: 409, message: 'This request was already handled' }
  if (!approve) {
    await prisma.walletWithdrawal.update({ where: { id }, data: { status: 'REJECTED', rejectedReason: reason ?? null, approvedById: userId, approvedAt: new Date() } })
    await notifyParents(w.studentId, 'Withdrawal not approved', reason ?? '', id)
    return { ok: true, withdrawalNumber: null }
  }
  let number: string | null = null
  try {
    await prisma.$transaction(async (tx) => {
      const bal = await walletBalance(w.studentId, tx)
      if (bal + 0.001 < Number(w.amount)) throw new Error(`NOT_ENOUGH:${bal}`)
      for (let attempt = 0; ; attempt++) {
        number = await nextWithdrawalNumber(tx)
        try {
          const upd = await tx.walletWithdrawal.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', withdrawalNumber: number, approvedById: userId, approvedAt: new Date() } })
          if (upd.count !== 1) throw new Error('HANDLED')
          break
        } catch (err) {
          if (attempt < 4 && isUniqueConflictOn(err, 'withdrawalNumber')) continue
          throw err
        }
      }
      await tx.walletTransaction.create({ data: { studentId: w.studentId, amount: -Number(w.amount), type: 'WITHDRAW', withdrawalId: id, note: `Withdrawal ${number} (${w.payoutMethod}, fee ${Number(w.fee)})`, createdById: userId } })
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'HANDLED') return { ok: false, status: 409, message: 'This request was already handled' }
    if (err instanceof Error && err.message.startsWith('NOT_ENOUGH:')) return { ok: false, status: 409, message: `The wallet no longer has that much (${err.message.split(':')[1]} EGP)` }
    throw err
  }
  await notifyParents(w.studentId, 'Withdrawal approved', `${Number(w.amount) - Number(w.fee)} EGP will be paid back by ${w.payoutMethod} (${number}).`, id)
  return { ok: true, withdrawalNumber: number }
}

// ── prepaid total (accounts) ────────────────────────────────────────────────
export async function prepaidTotal(campusId?: string | null): Promise<number> {
  const agg = await prisma.walletTransaction.aggregate({
    where: campusId ? { studentId: { in: (await prisma.student.findMany({ where: { campusId }, select: { id: true } })).map((s) => s.id) } } : {},
    _sum: { amount: true },
  })
  return round2(Number(agg._sum.amount ?? 0))
}

// ── notifications (never break the main action) ─────────────────────────────
const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SECRETARY'] as const
async function notifyApprovers(title: string, message: string, relatedId: string) {
  try {
    const roles = STAFF_ROLES.filter((r) => checkPermission(r, 'wallet', 'approve'))
    const users = await prisma.user.findMany({ where: { role: { in: [...roles] }, isActive: true }, select: { id: true } })
    if (users.length) await prisma.notification.createMany({ data: users.map((u) => ({ userId: u.id, title, message, type: 'WALLET', relatedId })) })
  } catch (err) {
    console.error('[WALLET_NOTIFY]', err)
  }
}
export async function notifyParents(studentId: string, title: string, message: string, relatedId: string) {
  try {
    const s = await prisma.student.findUnique({ where: { id: studentId }, select: { guardians: { select: { userId: true } } } })
    const rows = (s?.guardians ?? []).map((g) => ({ userId: g.userId, title, message, type: 'WALLET', relatedId }))
    if (rows.length) await prisma.notification.createMany({ data: rows })
  } catch (err) {
    console.error('[WALLET_NOTIFY_PARENT]', err)
  }
}

// ── low-balance alerts (daily cron) ─────────────────────────────────────────
/**
 * For monthly groups whose current month ends within `lowBalanceDays`: parents of
 * students whose wallet is below next month's price get one portal notification
 * per month (deduplicated by type + relatedId) and a contact-log line.
 */
export async function lowBalanceAlerts(): Promise<{ checked: number; alerted: number }> {
  const { isEventOn } = await import('@/lib/notifications/events')
  if (!(await isEventOn('LOW_BALANCE'))) return { checked: 0, alerted: 0 }
  const s = await getWalletSettings()
  const days = Math.max(0, s.lowBalanceDays ?? 3)
  const { estimateGroupEnds } = await import('@/lib/groups/end-estimates')
  const groups = await prisma.classSection.findMany({
    where: { status: 'ACTIVE', isActive: true, level: { pricingType: 'MONTHLY' } },
    select: {
      id: true, status: true, completedAt: true, currentCycleNumber: true, currentCycleStartDate: true, startDate: true, scheduleSlots: true, className: true, sectionName: true,
      level: { select: { numberOfSessions: true, numberOfMonths: true, pricingType: true, monthlyPrice: true } },
      enrollments: { where: { status: 'ACTIVE' }, select: { studentId: true } },
    },
  })
  const limit = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
  let checked = 0
  let alerted = 0
  for (const g of groups) {
    if (!g.level || !g.startDate) continue
    const ends = await estimateGroupEnds(g)
    if (!ends.cycleEnd || ends.cycleEnd > limit) continue
    const price = Number(g.level.monthlyPrice ?? 0)
    if (!(price > 0)) continue
    for (const e of g.enrollments) {
      checked++
      const balance = await walletBalance(e.studentId)
      if (balance + 0.001 >= price) continue
      const key = `${g.id}:${e.studentId}`
      if (await prisma.notification.findFirst({ where: { type: 'LOW_BALANCE', relatedId: key }, select: { id: true } })) continue
      const stu = await prisma.student.findUnique({ where: { id: e.studentId }, select: { firstName: true, guardians: { select: { id: true, userId: true } } } })
      if (!stu?.guardians.length) continue
      const label = `${g.className} ${g.sectionName}`.trim()
      const msg = `${stu.firstName}'s wallet has ${balance} EGP; next month in ${label} is about ${price} EGP. Please top up before ${ends.cycleEnd}.`
      try {
        await prisma.notification.createMany({ data: stu.guardians.map((gd) => ({ userId: gd.userId, title: 'Wallet balance is low', message: msg, type: 'LOW_BALANCE', relatedId: key })) })
      } catch (err) {
        console.error('[LOW_BALANCE_NOTIFY]', err)
      }
      await logSystemContact({ studentId: e.studentId, guardianId: stu.guardians[0].id, channel: 'SYSTEM', reason: 'PAYMENT', summary: `Low wallet balance alert sent in the parent portal (${balance} EGP, next month ${price} EGP).` })
      alerted++
    }
  }
  return { checked, alerted }
}
