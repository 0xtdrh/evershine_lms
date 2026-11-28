/**
 * MONEY deep check part D (owner 28/11): random money work on a LOCAL test copy, several at the same moment, then the
 * money rules (lib/health/money-rules.ts) must all still hold. Operations: pay (part / all / a bit too much), staff
 * top-up, pay from the wallet, refund (wallet / cash), withdrawal request + approval, cancel a receipt (asked by one
 * admin, approved by another). Every answer must be 2xx or a clean 4xx — never 5xx.
 *
 *   DATABASE_URL=mysql://root@127.0.0.1:3420/technova AUTH_SECRET=<copy secret> npx tsx scripts/security/money-fuzz.ts http://127.0.0.1:3100 [steps=150] [seed=1]
 * Local copies only. It CHANGES the copy's data (marked "fuzz" in reasons / remarks).
 */

import { PrismaClient } from '@prisma/client'
import { encode } from 'next-auth/jwt'
import { runMoneyRules } from '../../lib/health/money-rules'

const BASE = process.argv[2] ?? 'http://127.0.0.1:3100'
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) { console.error('Refusing: local copies only.'); process.exit(1) }
const STEPS = Number(process.argv[3] ?? 150)
let seed = Number(process.argv[4] ?? 1)
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]
const p = new PrismaClient()

async function cookieFor(where: { role?: string; email?: string }) {
  const u = await p.user.findFirstOrThrow({ where: { isActive: true, ...(where.email ? { email: where.email } : { role: where.role as never }) }, select: { id: true, email: true, role: true } })
  return 'authjs.session-token=' + (await encode({ token: { sub: u.id, id: u.id, email: u.email, role: u.role, campusId: null, loginAt: Date.now(), twoFactorSetup: false }, secret: process.env.AUTH_SECRET!, salt: 'authjs.session-token', maxAge: 3600 }))
}

const stats: Record<string, Record<string, number>> = {}
const crashes: string[] = []
async function call(name: string, cookie: string, method: string, path: string, body?: unknown) {
  const r = await fetch(BASE + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  const k = r.status >= 500 ? '5xx' : r.status >= 400 ? '4xx' : '2xx'
  ;(stats[name] ??= {})[k] = ((stats[name] ??= {})[k] ?? 0) + 1
  if (r.status >= 500) crashes.push(`${r.status} ${name} ${path} ${text.slice(0, 160)}`)
  try { return { status: r.status, json: JSON.parse(text) } } catch { return { status: r.status, json: null } }
}

async function main() {
  const sa = await cookieFor({ role: 'SUPER_ADMIN' })
  const admin2 = await cookieFor({ role: 'ADMIN' })
  const invoices = async () => p.feeInvoice.findMany({ where: { status: { not: 'CANCELLED' }, totalAmount: { gt: 0 } }, select: { id: true, studentId: true, totalAmount: true, paidAmount: true, refundedAmount: true }, take: 60, orderBy: { createdAt: 'desc' } })
  const amt = (max: number) => Math.max(0.01, Math.round((rnd() < 0.3 ? max : rnd() < 0.5 ? max + 0.01 : rnd() * max) * 100) / 100)

  const ops: (() => Promise<unknown>)[] = []
  const steps = async () => {
    const inv = await invoices()
    if (!inv.length) return
    const i = pick(inv), left = Number(i.totalAmount) - Number(i.paidAmount), net = Number(i.paidAmount) - Number(i.refundedAmount)
    const kind = pick(['pay', 'pay', 'topup', 'wallet', 'refund', 'withdraw', 'void'])
    if (kind === 'pay' && left > 0) return call('pay', sa, 'POST', `/api/fees/${i.id}/payments`, { amount: amt(left), paymentMethod: 'Cash', remarks: 'fuzz' })
    if (kind === 'topup') return call('topup', sa, 'POST', '/api/wallet/topups', { studentId: i.studentId, amount: Math.round(200 + rnd() * 800), method: 'Cash' })
    if (kind === 'wallet' && left > 0) return call('payFromWallet', sa, 'POST', `/api/fees/${i.id}/pay-from-wallet`, rnd() < 0.5 ? {} : { amount: amt(left) })
    if (kind === 'refund' && net > 0) return call('refund', sa, 'POST', '/api/refunds', { invoiceId: i.id, amount: amt(Math.min(net, 50)), method: rnd() < 0.5 ? 'WALLET' : 'CASH', payoutMethod: 'InstaPay', reason: 'fuzz' })
    if (kind === 'withdraw') {
      const r = await call('withdrawRequest', sa, 'POST', '/api/wallet/withdrawals', { studentId: i.studentId, amount: Math.round(10 + rnd() * 300), payoutMethod: 'Cash', reason: 'fuzz' })
      const id = r.json?.data?.withdrawalId
      if (id) return call('withdrawApprove', admin2, 'PATCH', `/api/wallet/withdrawals/${id}`, { action: 'approve' })
      return
    }
    if (kind === 'void') {
      const pay = await p.feePayment.findFirst({ where: { invoiceId: i.id, status: 'COMPLETED', source: { in: ['STAFF', 'WALLET'] } }, orderBy: { createdAt: 'desc' }, select: { id: true } })
      if (!pay) return
      const r = await call('voidRequest', admin2, 'POST', '/api/payment-voids', { paymentId: pay.id, reason: 'fuzz: saved by mistake' })
      const id = r.json?.data?.id
      if (id) return call('voidApprove', sa, 'PATCH', `/api/payment-voids/${id}`, { action: 'approve' })
    }
  }
  for (let k = 0; k < STEPS; k++) ops.push(steps)
  // 4 at the same moment, like a busy office
  for (let k = 0; k < ops.length; k += 4) await Promise.all(ops.slice(k, k + 4).map((f) => f().catch((e) => crashes.push('THROW ' + String(e).slice(0, 120)))))

  const results = await runMoneyRules(p)
  const broken = results.filter((r) => r.bad !== 0)
  console.log('answers by action:', JSON.stringify(stats))
  for (const c of crashes) console.log('CRASH ' + c)
  for (const r of broken) { console.log(`BROKEN ${r.en} — ${r.bad}`); for (const s of r.sample) console.log('       ', JSON.stringify(s)) }
  console.log(`\n${STEPS} random steps; ${crashes.length} crashes; ${broken.length} of ${results.length} money rules broken`)
  await p.$disconnect()
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1) })
