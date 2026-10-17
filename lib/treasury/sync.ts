/**
 * FIN-1: keep the money movements in step with their source records — automatically, from outside the payment
 * transactions (so recording a payment never depends on it). Idempotent: one movement per source row (unique ids).
 * - money IN : invoice payments paid by staff / receipt / online (NOT wallet payments: that money already came in),
 *              wallet top-ups by staff / receipt / online (not the ones made by a payment), partner → TechNova
 * - money OUT: cash refunds, approved wallet withdrawals (minus the fee kept), expenses, paid salaries, TechNova → partner
 * The account comes from the payment method + branch (lib/treasury/rules.ts pickAccount). Movements whose source was
 * undone (deleted expense, salary no longer paid) are removed; "not placed" ones are placed once a route exists.
 * Runs when money pages / balances load, from the daily job and after a sync request. Server-only.
 */

import { prisma } from '@/lib/prisma'
import { pickAccount, type Route } from './rules'

const BATCH = 500
let running: Promise<number> | null = null
let last = 0

const num = (v: unknown) => Number(v ?? 0)
type New = {
  direction: 'IN' | 'OUT'; amount: number; date: Date; kind: string; method: string | null; campusId: string | null; note?: string | null
  feePaymentId?: string; topUpId?: string; refundId?: string; withdrawalId?: string; expenseId?: string; salarySlipId?: string; partnerPaymentId?: string
}

async function missing(sql: string): Promise<string[]> {
  return (await prisma.$queryRawUnsafe<{ id: string }[]>(sql)).map((r) => r.id)
}

async function studentCampus(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  return new Map((await prisma.student.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, campusId: true } })).map((s) => [s.id, s.campusId]))
}

async function routes(): Promise<Route[]> {
  return prisma.accountRoute.findMany({ select: { method: true, campusId: true, accountId: true } })
}

async function write(rows: New[], r: Route[]) {
  if (!rows.length) return 0
  const res = await prisma.moneyMovement.createMany({
    data: rows.filter((x) => x.amount > 0).map((x) => ({ ...x, accountId: pickAccount(r, x.method, x.campusId), note: x.note?.slice(0, 300) ?? null })),
    skipDuplicates: true,
  })
  return res.count
}

/** One pass over every source. Throttled (30 s) unless forced; never runs twice at once. */
export async function syncMovements(force = false): Promise<number> {
  if (running) return running
  if (!force && Date.now() - last < 30_000) return 0
  running = (async () => {
    try {
      const r = await routes()
      let n = 0

      // invoice payments (money in) — not wallet payments
      const pay = await missing(`SELECT p.id FROM FeePayment p LEFT JOIN MoneyMovement m ON m.feePaymentId = p.id WHERE m.id IS NULL AND p.status = 'COMPLETED' AND (p.source IS NULL OR p.source IN ('STAFF','PROOF','ONLINE')) LIMIT ${BATCH}`)
      if (pay.length) {
        const rows = await prisma.feePayment.findMany({ where: { id: { in: pay } }, select: { id: true, amount: true, paymentMethod: true, paymentDate: true, receiptNumber: true, invoice: { select: { classSection: { select: { campusId: true } }, student: { select: { campusId: true } } } } } })
        n += await write(rows.map((p) => ({ direction: 'IN', amount: num(p.amount), date: p.paymentDate, kind: 'PAYMENT', method: p.paymentMethod, campusId: p.invoice?.classSection?.campusId ?? p.invoice?.student?.campusId ?? null, note: p.receiptNumber, feePaymentId: p.id })), r)
      }

      // wallet top-ups (money in) — the ones a payment made are already counted above
      const top = await missing(`SELECT t.id FROM WalletTopUp t LEFT JOIN MoneyMovement m ON m.topUpId = t.id WHERE m.id IS NULL AND t.status = 'APPROVED' AND t.source IN ('STAFF','PROOF','ONLINE') LIMIT ${BATCH}`)
      if (top.length) {
        const rows = await prisma.walletTopUp.findMany({ where: { id: { in: top } }, select: { id: true, amount: true, fee: true, method: true, approvedAt: true, createdAt: true, topUpNumber: true, studentId: true } })
        const sc = await studentCampus(rows.map((x) => x.studentId))
        n += await write(rows.map((t) => ({ direction: 'IN', amount: num(t.amount) + num(t.fee), date: t.approvedAt ?? t.createdAt, kind: 'TOPUP', method: t.method, campusId: sc.get(t.studentId) ?? null, note: t.topUpNumber, topUpId: t.id })), r)
      }

      // cash refunds (money out) — wallet refunds stay inside the wallet
      const ref = await missing(`SELECT f.id FROM Refund f LEFT JOIN MoneyMovement m ON m.refundId = f.id WHERE m.id IS NULL AND f.status = 'APPROVED' AND f.method = 'CASH' LIMIT ${BATCH}`)
      if (ref.length) {
        const rows = await prisma.refund.findMany({ where: { id: { in: ref } }, select: { id: true, amount: true, payoutMethod: true, approvedAt: true, createdAt: true, refundNumber: true, invoiceId: true, studentId: true } })
        const inv = new Map((await prisma.feeInvoice.findMany({ where: { id: { in: rows.map((x) => x.invoiceId) } }, select: { id: true, classSection: { select: { campusId: true } }, student: { select: { campusId: true } } } })).map((i) => [i.id, i.classSection?.campusId ?? i.student?.campusId ?? null]))
        n += await write(rows.map((f) => ({ direction: 'OUT', amount: num(f.amount), date: f.approvedAt ?? f.createdAt, kind: 'REFUND', method: f.payoutMethod || 'Cash', campusId: inv.get(f.invoiceId) ?? null, note: f.refundNumber, refundId: f.id })), r)
      }

      // wallet withdrawals (money out, the fee stays with TechNova)
      const wd = await missing(`SELECT w.id FROM WalletWithdrawal w LEFT JOIN MoneyMovement m ON m.withdrawalId = w.id WHERE m.id IS NULL AND w.status = 'APPROVED' LIMIT ${BATCH}`)
      if (wd.length) {
        const rows = await prisma.walletWithdrawal.findMany({ where: { id: { in: wd } }, select: { id: true, amount: true, fee: true, payoutMethod: true, approvedAt: true, createdAt: true, withdrawalNumber: true, studentId: true } })
        const sc = await studentCampus(rows.map((x) => x.studentId))
        n += await write(rows.map((w) => ({ direction: 'OUT', amount: num(w.amount) - num(w.fee), date: w.approvedAt ?? w.createdAt, kind: 'WITHDRAWAL', method: w.payoutMethod, campusId: sc.get(w.studentId) ?? null, note: w.withdrawalNumber, withdrawalId: w.id })), r)
      }

      // expenses (money out)
      const ex = await missing(`SELECT e.id FROM Expense e LEFT JOIN MoneyMovement m ON m.expenseId = e.id WHERE m.id IS NULL AND e.isDeleted = 0 LIMIT ${BATCH}`)
      if (ex.length) {
        const rows = await prisma.expense.findMany({ where: { id: { in: ex } }, select: { id: true, amount: true, paymentSource: true, date: true, campusId: true, title: true } })
        n += await write(rows.map((e) => ({ direction: 'OUT', amount: num(e.amount), date: e.date, kind: 'EXPENSE', method: e.paymentSource || 'Cash', campusId: e.campusId, note: e.title, expenseId: e.id })), r)
      }

      // paid salaries (money out)
      const sal = await missing(`SELECT s.id FROM SalarySlip s LEFT JOIN MoneyMovement m ON m.salarySlipId = s.id WHERE m.id IS NULL AND s.status = 'PAID' AND s.approvalStatus IN ('APPROVED','LEGACY') LIMIT ${BATCH}`)
      if (sal.length) {
        const rows = await prisma.salarySlip.findMany({ where: { id: { in: sal } }, select: { id: true, netSalary: true, paymentSource: true, paymentDate: true, issueDate: true, employeeId: true, employeeName: true, month: true } })
        const ids = rows.map((x) => x.employeeId)
        const [admins, teachers] = await Promise.all([
          prisma.admin.findMany({ where: { userId: { in: ids } }, select: { userId: true, campusId: true } }),
          prisma.teacher.findMany({ where: { userId: { in: ids } }, select: { userId: true, campusId: true } }),
        ])
        const camp = new Map([...admins, ...teachers].map((x) => [x.userId, x.campusId]))
        n += await write(rows.map((s) => ({ direction: 'OUT', amount: num(s.netSalary), date: s.paymentDate ?? s.issueDate, kind: 'SALARY', method: s.paymentSource || 'Cash', campusId: camp.get(s.employeeId) ?? null, note: `${s.employeeName} · ${s.month}`, salarySlipId: s.id })), r)
      }

      // partner payments (both ways)
      const pp = await missing(`SELECT p.id FROM PartnerStatementPayment p LEFT JOIN MoneyMovement m ON m.partnerPaymentId = p.id WHERE m.id IS NULL LIMIT ${BATCH}`)
      if (pp.length) {
        const rows = await prisma.partnerStatementPayment.findMany({ where: { id: { in: pp } }, select: { id: true, direction: true, amount: true, method: true, paidAt: true, statement: { select: { campusId: true, number: true } } } })
        n += await write(rows.map((p) => ({ direction: p.direction === 'PARTNER_TO_TECHNOVA' ? 'IN' : 'OUT', amount: num(p.amount), date: p.paidAt, kind: 'PARTNER', method: p.method, campusId: p.statement?.campusId ?? null, note: p.statement?.number ?? null, partnerPaymentId: p.id })), r)
      }

      // undone sources: deleted expenses, salaries no longer paid
      await prisma.$executeRawUnsafe(`DELETE m FROM MoneyMovement m JOIN Expense e ON e.id = m.expenseId WHERE e.isDeleted = 1`)
      await prisma.$executeRawUnsafe(`DELETE m FROM MoneyMovement m JOIN SalarySlip s ON s.id = m.salarySlipId WHERE NOT (s.status = 'PAID' AND s.approvalStatus IN ('APPROVED','LEGACY'))`)

      // place movements that had no account yet, now that a route may exist
      if (r.length) {
        const loose = await prisma.moneyMovement.findMany({ where: { accountId: null }, select: { id: true, method: true, campusId: true }, take: 2000 })
        for (const m of loose) {
          const acc = pickAccount(r, m.method, m.campusId)
          if (acc) { await prisma.moneyMovement.update({ where: { id: m.id }, data: { accountId: acc } }); n++ }
        }
      }
      last = Date.now()
      return n
    } catch (err) {
      console.error('[TREASURY_SYNC]', err)
      return 0
    } finally {
      running = null
    }
  })()
  return running
}
