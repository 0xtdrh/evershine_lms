/**
 * LOAD TEST runner (owner 22/11). Many people using the system at once, against a THROW-AWAY local copy only.
 *
 *   DATABASE_URL=mysql://root@127.0.0.1:3430/technova LOAD_SECRET=<secret.txt of that copy> \
 *     npx tsx scripts/load/run.ts http://localhost:3200 [users=300] [seconds=180] [rampSeconds=60]
 *
 * Each virtual person gets a real session (signed with the copy's own secret, so 300 sign-ins do not hit the sign-in
 * rate limit) and repeats what their screen does, with a few seconds of "reading" between steps:
 *   parents (60 %)  my-children: children, one child's academic page, attendance, wallet, renewals, the 30 s badge poll
 *   students (15 %) learning page: upcoming sessions, lessons, badge poll
 *   staff (25 %)    home numbers + today tasks, groups list + one group, students list, invoices list + search, roster
 * Prints, per request type: count, errors, p50 / p95 / max time, and the totals. Refuses a non-local base URL.
 */

import { PrismaClient } from '@prisma/client'
import { encode } from 'next-auth/jwt'

const BASE = process.argv[2] ?? 'http://localhost:3200'
const USERS = Number(process.argv[3] ?? 300)
const SECONDS = Number(process.argv[4] ?? 180)
const RAMP = Number(process.argv[5] ?? 60)
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) { console.error('Refusing: the base URL must be a local copy.'); process.exit(1) }
const SECRET = process.env.LOAD_SECRET ?? ''
if (!SECRET) { console.error('Set LOAD_SECRET to the secret.txt of the local copy.'); process.exit(1) }

const p = new PrismaClient()
type Stat = { n: number; err: number; ms: number[]; codes: Record<string, number> }
const stats = new Map<string, Stat>()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// THINK=10 → people read 10× longer between clicks (20–60 s: a realistic pace); default 1 = a stress test
const THINK = Number(process.env.THINK ?? 1)
const think = () => sleep((2000 + Math.random() * 4000) * THINK)
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]

async function cookieFor(u: { id: string; email: string; role: string; campusId: string | null; name: string }) {
  const token = await encode({
    token: { sub: u.id, id: u.id, email: u.email, name: u.name, role: u.role, campusId: u.campusId, loginAt: Date.now(), twoFactorSetup: false, mustChangePassword: false },
    secret: SECRET, salt: 'authjs.session-token', maxAge: 8 * 3600,
  })
  return `authjs.session-token=${token}; tn-lang=ar`
}

async function hit(label: string, cookie: string, path: string, method: 'GET' | 'POST' = 'GET') {
  const t = performance.now()
  let code = 'ERR'
  try {
    const r = await fetch(BASE + path, { method, headers: { cookie, 'content-type': 'application/json', origin: BASE, accept: path.startsWith('/api') ? 'application/json' : 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    code = String(r.status)
    await r.arrayBuffer()
  } catch (e) { code = (e as Error).name === 'TimeoutError' ? 'TIMEOUT' : 'ERR' }
  const ms = performance.now() - t
  const s = stats.get(label) ?? { n: 0, err: 0, ms: [], codes: {} }
  s.n++; s.ms.push(ms); s.codes[code] = (s.codes[code] ?? 0) + 1
  if (!/^2|^3/.test(code)) s.err++
  stats.set(label, s)
}

async function main() {
  // people to play: LOAD parents / students, and real staff of the copy
  const parents = await p.guardian.findMany({ where: { phoneNumber: { startsWith: '019' } }, select: { userId: true, students: { select: { id: true } } }, take: 2000 })
  const studs = await p.student.findMany({ where: { registrationNumber: { startsWith: 'LOAD/' } }, select: { id: true, userId: true }, take: 2000 })
  const staff = await p.user.findMany({ where: { isActive: true, role: { in: ['ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT'] } }, select: { id: true, email: true, role: true, displayName: true } })
  const groups = (await p.classSection.findMany({ where: { className: { startsWith: 'LOAD' } }, select: { id: true } })).map((g) => g.id)
  const userRows = await p.user.findMany({ where: { id: { in: [...parents.map((x) => x.userId), ...studs.map((x) => x.userId), ...staff.map((x) => x.id)] } }, select: { id: true, email: true, role: true, displayName: true } })
  const byId = new Map(userRows.map((u) => [u.id, u]))
  const campusOf = new Map<string, string | null>()
  for (const s of staff) {
    const a = await p.admin.findFirst({ where: { userId: s.id }, select: { campusId: true } }).catch(() => null)
    campusOf.set(s.id, a?.campusId ?? null)
  }
  if (!parents.length || !studs.length || !staff.length) throw new Error('Run scripts/load/seed.ts first.')
  console.log(`playing ${USERS} people for ${SECONDS}s (ramp ${RAMP}s) — parents ${parents.length}, students ${studs.length}, staff ${staff.length}`)

  const end = Date.now() + (RAMP + SECONDS) * 1000
  const measureFrom = Date.now() + RAMP * 1000
  const people: Promise<void>[] = []
  for (let i = 0; i < USERS; i++) {
    const r = i % 20
    const kind = r < 12 ? 'parent' : r < 15 ? 'student' : 'staff'
    people.push((async () => {
      await sleep((i / USERS) * RAMP * 1000)
      if (kind === 'parent') {
        const g = parents[i % parents.length]
        const u = byId.get(g.userId)!
        const cookie = await cookieFor({ id: u.id, email: u.email, role: u.role, campusId: null, name: u.displayName ?? '' })
        const kid = g.students[0]?.id
        while (Date.now() < end) {
          await hit('page /dashboard/my-children', cookie, '/dashboard/my-children')
          await Promise.all([
            hit('api guardian children', cookie, '/api/guardian-portal/children'),
            hit('api notifications/counts', cookie, '/api/notifications/counts'),
            hit('api announcements feed', cookie, '/api/announcements'),
            hit('api guardian wallet', cookie, '/api/guardian-portal/wallet'),
            hit('api guardian renewals', cookie, '/api/guardian-portal/renewals'),
          ])
          if (kid) await Promise.all([
            hit('api child academic', cookie, `/api/guardian-portal/children/${kid}/academic`),
            hit('api attendance-timeline', cookie, `/api/students/${kid}/attendance-timeline`),
            hit('api upcoming-sessions', cookie, `/api/students/${kid}/upcoming-sessions`),
          ])
          await think()
          await hit('api notifications/counts', cookie, '/api/notifications/counts')
          await think()
        }
      } else if (kind === 'student') {
        const s = studs[i % studs.length]
        const u = byId.get(s.userId)!
        const cookie = await cookieFor({ id: u.id, email: u.email, role: u.role, campusId: null, name: u.displayName ?? '' })
        while (Date.now() < end) {
          await hit('page /dashboard/learning', cookie, '/dashboard/learning')
          await Promise.all([
            hit('api notifications/counts', cookie, '/api/notifications/counts'),
            hit('api upcoming-sessions (me)', cookie, '/api/students/me/upcoming-sessions'),
          ])
          await think(); await think()
        }
      } else {
        const st = staff[i % staff.length]
        const cookie = await cookieFor({ id: st.id, email: st.email, role: st.role, campusId: campusOf.get(st.id) ?? null, name: st.displayName ?? '' })
        // only groups this person may open (a branch secretary sees her branch) — else every click is a 403
        const mine = await fetch(`${BASE}/api/groups`, { headers: { cookie } }).then((r) => r.json()).then((j) => ((j.data ?? []) as { id: string }[]).map((g) => g.id)).catch(() => [] as string[])
        const myGroups = mine.length ? mine : groups
        while (Date.now() < end) {
          await hit('page /dashboard', cookie, '/dashboard')
          await Promise.all([
            hit('api dashboard/insights', cookie, '/api/dashboard/insights'),
            hit('api today', cookie, '/api/today'),
            hit('api notifications/counts', cookie, '/api/notifications/counts'),
          ])
          await think()
          await hit('api groups (list)', cookie, '/api/groups')
          const g = pick(myGroups)
          await Promise.all([hit('api groups/[id]', cookie, `/api/groups/${g}`), hit('api groups/[id]/sync-progress', cookie, `/api/groups/${g}/sync-progress`, 'POST')])
          await think()
          await hit('api students (list)', cookie, '/api/students?page=1&limit=20')
          await hit('api fees (list)', cookie, '/api/fees?page=1&limit=20')
          await hit('api fees (search)', cookie, `/api/fees?page=1&limit=20&search=Load${Math.floor(Math.random() * 2000)}`)
          await think()
          await hit('api attendance roster', cookie, `/api/enrollment-attendance/roster?classSectionId=${g}`)
          await think()
        }
      }
    })())
  }
  // drop the warm-up (ramp) numbers once the ramp is over
  setTimeout(() => stats.clear(), RAMP * 1000)
  await Promise.all(people)

  const q = (a: number[], f: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : 0 }
  const rows = [...stats.entries()].map(([k, s]) => ({ k, ...s, p50: q(s.ms, 0.5), p95: q(s.ms, 0.95), max: Math.max(...s.ms) })).sort((a, b) => b.p95 - a.p95)
  const all = rows.flatMap((r) => r.ms)
  const secs = (Date.now() - measureFrom) / 1000
  console.log(`\n${'request'.padEnd(36)} ${'n'.padStart(6)} ${'err'.padStart(5)} ${'p50'.padStart(7)} ${'p95'.padStart(7)} ${'max'.padStart(7)}  codes`)
  for (const r of rows) console.log(`${r.k.padEnd(36)} ${String(r.n).padStart(6)} ${String(r.err).padStart(5)} ${String(Math.round(r.p50)).padStart(7)} ${String(Math.round(r.p95)).padStart(7)} ${String(Math.round(r.max)).padStart(7)}  ${JSON.stringify(r.codes)}`)
  console.log(`\nTOTAL ${all.length} requests in ${Math.round(secs)} s = ${(all.length / secs).toFixed(1)} req/s · errors ${rows.reduce((a, r) => a + r.err, 0)} · p50 ${Math.round(q(all, 0.5))} ms · p95 ${Math.round(q(all, 0.95))} ms`)
  void measureFrom
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => p.$disconnect())
