/**
 * SECURITY deep check part B (owner 28/11): every API route that CHANGES data is called
 *   1) with NO sign-in, and 2) signed in as a PARENT and as a STUDENT (portal roles),
 * with empty / dummy bodies and made-up ids. A portal person or a stranger must never get a 2xx on a staff route,
 * and nothing may crash (5xx). Money tables are counted before / after: they must not change.
 *
 *   DATABASE_URL=mysql://root@127.0.0.1:3420/technova AUTH_SECRET=<copy secret> npx tsx scripts/security/write-probe.ts http://127.0.0.1:3100
 * Local copies only.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { encode } from 'next-auth/jwt'

const BASE = process.argv[2] ?? 'http://127.0.0.1:3100'
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) { console.error('Refusing: local copies only.'); process.exit(1) }
const p = new PrismaClient()

// routes a family / student may legitimately write to (their own things) — checked for no crash only
const PORTAL_OK = /^\/api\/(guardian-portal|guardian\/wards|student-portal|my-|notifications|activity|announcements\/[^/]+\/read|agreements|complaints|lessons\/progress|assignments|quizzes\/attempts|quizzes\/my|h5p\/result|gallery\/react|online\/join|videos\/watch|videos\/play|fees\/[^/]+\/(pay-online|pay-from-wallet|proof)|profile\/(me|items|requests)|passport\/\[|passport\/[^/]+\/share|passport\/shares|ratings|excuses|absence-excuses|users\/change-password|security\/two-factor|security\/csp-report|feedback|renewals|referrals\/me|cards\/portal|auth\/|public\/|webhooks\/|card-check|account\/setup|admissions\/apply|staff-applications\/apply|landing\/inquiries|public)/

function routes() {
  const out: { path: string; methods: string[] }[] = []
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n)
      if (statSync(f).isDirectory()) walk(f)
      else if (n === 'route.ts') {
        const s = readFileSync(f, 'utf8')
        const methods = ['POST', 'PUT', 'PATCH', 'DELETE'].filter((m) => new RegExp(`export\\s+(async\\s+function|const)\\s+${m}\\b`).test(s) || new RegExp(`export\\s*\\{[^}]*\\b${m}\\b`).test(s))
        if (methods.length) out.push({ path: '/' + f.replace(/\\/g, '/').replace(/^app\//, '').replace(/\/route\.ts$/, ''), methods })
      }
    }
  }
  walk('app/api')
  return out
}

const fill = (path: string) => path.replace(/\[\.\.\.[^\]]+\]/g, 'x/y').replace(/\[[^\]]+\]/g, 'zzprobe000000000000000000')

async function cookie(u: { id: string; email: string; role: string }) {
  const t = await encode({ token: { sub: u.id, id: u.id, email: u.email, role: u.role, campusId: null, loginAt: Date.now(), twoFactorSetup: false }, secret: process.env.AUTH_SECRET!, salt: 'authjs.session-token', maxAge: 3600 })
  return `authjs.session-token=${t}`
}

const MONEY_TABLES = ['FeePayment', 'FeeInvoice', 'WalletTransaction', 'WalletTopUp', 'WalletWithdrawal', 'Refund', 'MoneyMovement', 'MoneyTransfer', 'Expense', 'SalarySlip', 'DiscountAssignment', 'PaymentVoid', 'User', 'RolePermission', 'UserPermissionOverride']
async function counts() {
  const r: Record<string, number> = {}
  for (const t of MONEY_TABLES) r[t] = Number((await p.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) n FROM \`${t}\``))[0].n)
  return r
}

async function main() {
  const parentG = await p.guardian.findFirstOrThrow({ where: { phoneNumber: '01001234561' }, select: { userId: true } })
  const parent = await p.user.findUniqueOrThrow({ where: { id: parentG.userId }, select: { id: true, email: true, role: true } })
  const st = await p.student.findFirstOrThrow({ where: { registrationNumber: 'TN/2026/0001' }, select: { userId: true } })
  const student = await p.user.findUniqueOrThrow({ where: { id: st.userId }, select: { id: true, email: true, role: true } })
  const who: [string, string][] = [['nobody', ''], ['parent', await cookie(parent)], ['student', await cookie(student)]]
  const before = await counts()
  const bad: string[] = []
  let calls = 0
  for (const r of routes()) {
    const url = BASE + fill(r.path)
    for (const m of r.methods) {
      for (const [name, c] of who) {
        if (name !== 'nobody' && PORTAL_OK.test(r.path)) continue // their own area: checked by the family tests
        if (name === 'nobody' && /^\/api\/(auth\/|public\/|webhooks\/|card-check|account\/setup|admissions\/apply|staff-applications\/apply|landing\/inquiries|security\/csp-report|activity\/ping)/.test(r.path)) continue
        for (const body of ['{}', '{"amount":100,"studentId":"zz","invoiceId":"zz","role":"SUPER_ADMIN"}']) {
          calls++
          const res = await fetch(url, { method: m, headers: { 'content-type': 'application/json', ...(c ? { cookie: c } : {}) }, body: m === 'DELETE' && body === '{}' ? undefined : body, redirect: 'manual' }).catch((e) => ({ status: 0, text: async () => String(e) }) as never)
          const s = res.status
          if ((s >= 200 && s < 300) || s >= 500 || s === 0) bad.push(`${s} ${name.padEnd(8)} ${m.padEnd(6)} ${r.path}  ${(await res.text()).slice(0, 120).replace(/\s+/g, ' ')}`)
        }
      }
    }
  }
  const after = await counts()
  const changed = MONEY_TABLES.filter((t) => before[t] !== after[t]).map((t) => `${t}: ${before[t]} → ${after[t]}`)
  for (const b of bad) console.log('BAD  ' + b)
  console.log(`\n${calls} calls; ${bad.length} answered 2xx / 5xx; money & account tables changed: ${changed.length ? changed.join(', ') : 'none'}`)
  await p.$disconnect()
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1) })
