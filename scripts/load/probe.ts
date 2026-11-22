/**
 * LOAD TEST probe (owner 22/11): one request type at a time, nobody else on the copy — how long it takes and how many
 * database queries it makes (MySQL "Questions" counter before / after). Tells WHY a request is slow under load.
 *
 *   DATABASE_URL=mysql://root@127.0.0.1:3430/technova LOAD_SECRET=<secret> npx tsx scripts/load/probe.ts http://localhost:3200 [repeat=10]
 */

import { PrismaClient } from '@prisma/client'
import { encode } from 'next-auth/jwt'

const BASE = process.argv[2] ?? 'http://localhost:3200'
const REPEAT = Number(process.argv[3] ?? 10)
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) { console.error('Refusing: local copies only.'); process.exit(1) }
const SECRET = process.env.LOAD_SECRET ?? ''
const p = new PrismaClient()

async function questions(): Promise<number> {
  const r = await p.$queryRawUnsafe<{ Value: string }[]>("SHOW GLOBAL STATUS LIKE 'Questions'")
  return Number(r[0]?.Value ?? 0)
}
async function writes(): Promise<number> {
  const r = await p.$queryRawUnsafe<{ Variable_name: string; Value: string }[]>("SHOW GLOBAL STATUS WHERE Variable_name IN ('Com_insert','Com_update','Com_delete','Com_insert_select')")
  return r.reduce((a, x) => a + Number(x.Value), 0)
}
async function cookie(u: { id: string; email: string; role: string }) {
  const t = await encode({ token: { sub: u.id, id: u.id, email: u.email, role: u.role, campusId: null, loginAt: Date.now(), twoFactorSetup: false }, secret: SECRET, salt: 'authjs.session-token', maxAge: 3600 })
  return `authjs.session-token=${t}; tn-lang=ar`
}

async function main() {
  const staff = await p.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true, email: true, role: true } })
  const g = await p.guardian.findFirstOrThrow({ where: { phoneNumber: { startsWith: '019' } }, select: { userId: true, students: { select: { id: true } } } })
  const gu = await p.user.findUniqueOrThrow({ where: { id: g.userId }, select: { id: true, email: true, role: true } })
  const grp = await p.classSection.findFirstOrThrow({ where: { className: { startsWith: 'LOAD' } }, select: { id: true } })
  const sc = await cookie(staff)
  const pc = await cookie(gu)
  const kid = g.students[0].id
  const list: [string, string, string, ('GET' | 'POST')?][] = [
    ['staff', sc, '/api/today'],
    ['staff', sc, `/api/groups/${grp.id}/sync-progress`, 'POST'],
    ['staff', sc, `/api/groups/${grp.id}`],
    ['staff', sc, '/api/groups'],
    ['staff', sc, '/api/dashboard/insights'],
    ['staff', sc, `/api/enrollment-attendance/roster?classSectionId=${grp.id}`],
    ['staff', sc, '/api/fees?page=1&limit=20'],
    ['staff', sc, '/api/students?page=1&limit=20'],
    ['staff', sc, '/api/notifications/counts'],
    ['parent', pc, `/api/guardian-portal/children/${kid}/academic`],
    ['parent', pc, '/api/guardian-portal/children'],
    ['parent', pc, '/api/notifications/counts'],
    ['parent', pc, '/api/guardian-portal/wallet'],
    ['parent', pc, `/api/students/${kid}/upcoming-sessions`],
    ['parent', pc, '/dashboard/my-children'],
  ]
  console.log(`${'who'.padEnd(7)}${'request'.padEnd(58)}${'avg ms'.padStart(8)}${'queries'.padStart(9)}${'writes'.padStart(8)}  status`)
  for (const [who, c, path, method] of list) {
    await fetch(BASE + path, { method: method ?? 'GET', headers: { cookie: c, origin: BASE } }).then((r) => r.arrayBuffer()) // warm
    const q0 = await questions()
    const w0 = await writes()
    const t0 = performance.now()
    let status = 0
    for (let i = 0; i < REPEAT; i++) {
      const r = await fetch(BASE + path, { method: method ?? 'GET', headers: { cookie: c, origin: BASE, 'content-type': 'application/json' } })
      status = r.status; await r.arrayBuffer()
    }
    const ms = (performance.now() - t0) / REPEAT
    const w = ((await writes()) - w0) / REPEAT
    const q = ((await questions()) - q0 - 2) / REPEAT
    console.log(`${who.padEnd(7)}${(method === 'POST' ? 'POST ' : '') + path.replace(/[a-z0-9]{20,}/g, ':id').slice(0, 56).padEnd(58)}${ms.toFixed(0).padStart(8)}${q.toFixed(0).padStart(9)}${w.toFixed(1).padStart(8)}  ${status}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => p.$disconnect())
