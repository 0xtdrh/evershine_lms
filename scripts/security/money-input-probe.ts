/**
 * MONEY deep check part C (owner 28/11): bad numbers sent to every endpoint that moves money, signed in as the
 * Super Admin (the most powerful account, so only the input rules stop it). Each must be REFUSED (4xx) — never
 * accepted (2xx) and never crash (5xx) — and no money row may change.
 *
 *   DATABASE_URL=mysql://root@127.0.0.1:3420/technova AUTH_SECRET=<copy secret> npx tsx scripts/security/money-input-probe.ts http://127.0.0.1:3100
 * Local copies only.
 */

import { PrismaClient } from '@prisma/client'
import { encode } from 'next-auth/jwt'

const BASE = process.argv[2] ?? 'http://127.0.0.1:3100'
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) { console.error('Refusing: local copies only.'); process.exit(1) }
const p = new PrismaClient()

const BAD_AMOUNTS: unknown[] = [-100, 0, -0.01, 1e12, 'abc', null, '100; DROP TABLE x', Number.NaN, '1e9', [], {}]
const TABLES = ['FeePayment', 'FeeInvoice', 'WalletTransaction', 'WalletTopUp', 'WalletWithdrawal', 'Refund', 'MoneyMovement', 'MoneyTransfer', 'Expense', 'DiscountAssignment', 'CashCount']
const counts = async () => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, Number((await p.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) n FROM \`${t}\``))[0].n)])))

async function main() {
  const sa = await p.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true, email: true, role: true } })
  const t = await encode({ token: { sub: sa.id, id: sa.id, email: sa.email, role: sa.role, campusId: null, loginAt: Date.now(), twoFactorSetup: false }, secret: process.env.AUTH_SECRET!, salt: 'authjs.session-token', maxAge: 3600 })
  const cookie = `authjs.session-token=${t}`
  const unpaid = await p.feeInvoice.findFirstOrThrow({ where: { status: { in: ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'] as never }, totalAmount: { gt: 0 } }, select: { id: true, studentId: true } })
  const paid = await p.feeInvoice.findFirst({ where: { paidAmount: { gt: 0 } }, select: { id: true, studentId: true } })
  const sib = await p.student.findFirst({ where: { id: { not: unpaid.studentId } }, select: { id: true } })
  const account = await p.moneyAccount.findFirst({ select: { id: true } }).catch(() => null)
  const account2 = account ? await p.moneyAccount.findFirst({ where: { id: { not: account.id } }, select: { id: true } }).catch(() => null) : null
  const discountType = await p.discountType.findFirst({ select: { id: true } }).catch(() => null)

  const cases: { name: string; method: string; path: string; body: (a: unknown) => unknown }[] = [
    { name: 'record a payment', method: 'POST', path: `/api/fees/${unpaid.id}/payments`, body: (a) => ({ amount: a, paymentMethod: 'Cash' }) },
    { name: 'staff wallet top-up', method: 'POST', path: '/api/wallet/topups', body: (a) => ({ studentId: unpaid.studentId, amount: a, method: 'Cash' }) },
    { name: 'wallet withdrawal', method: 'POST', path: '/api/wallet/withdrawals', body: (a) => ({ studentId: unpaid.studentId, amount: a, payoutMethod: 'Cash' }) },
    { name: 'wallet transfer', method: 'POST', path: `/api/students/${unpaid.studentId}/wallet/transfer`, body: (a) => ({ toStudentId: sib?.id, amount: a }) },
    { name: 'pay from wallet', method: 'POST', path: `/api/fees/${unpaid.id}/pay-from-wallet`, body: (a) => ({ amount: a }) },
    ...(paid ? [{ name: 'refund', method: 'POST', path: '/api/refunds', body: (a: unknown) => ({ invoiceId: paid.id, amount: a, method: 'WALLET' }) }] : []),
    { name: 'expense', method: 'POST', path: '/api/accountant/expenses', body: (a) => ({ title: 'probe', amount: a, date: new Date().toISOString().slice(0, 10), category: 'MISCELLANEOUS', paymentSource: 'Cash' }) },
    ...(account && account2 ? [{ name: 'money transfer between accounts', method: 'POST', path: '/api/treasury/transfers', body: (a: unknown) => ({ fromAccountId: account.id, toAccountId: account2.id, amount: a }) }] : []),
    ...(account ? [{ name: 'cash count', method: 'POST', path: '/api/treasury/counts', body: (a: unknown) => ({ accountId: account.id, counted: a }) }] : []),
    ...(discountType ? [{ name: 'discount on a student', method: 'POST', path: '/api/discounts', body: (a: unknown) => ({ discountTypeId: discountType.id, scope: 'STUDENT', studentId: unpaid.studentId, value: a }) }] : []),
  ]
  const before = await counts()
  const bad: string[] = []
  let n = 0
  for (const c of cases) {
    for (const a of BAD_AMOUNTS) {
      n++
      const res = await fetch(BASE + c.path, { method: c.method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(c.body(a)) })
      const s = res.status
      if (s < 400 || s >= 500) bad.push(`${s} ${c.name.padEnd(32)} amount=${JSON.stringify(a)}  ${(await res.text()).slice(0, 140).replace(/\s+/g, ' ')}`)
    }
  }
  const after = await counts()
  const changed = TABLES.filter((x) => before[x] !== after[x]).map((x) => `${x}: ${before[x]} → ${after[x]}`)
  for (const b of bad) console.log('BAD  ' + b)
  console.log(`\n${n} bad-number calls on ${cases.length} money actions; ${bad.length} not refused; tables changed: ${changed.length ? changed.join(', ') : 'none'}`)
  await p.$disconnect()
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1) })
