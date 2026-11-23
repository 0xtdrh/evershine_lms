/**
 * SECURITY PART 2 (23/11): can a signed-in person open somebody else's data by changing the id in the address?
 * Signs in (a signed session cookie, like the load test) as one parent, one student and one instructor of the LOCAL test
 * copy, then asks for another family's / group's rows. Anything that answers 200 with data is printed as LEAK.
 *
 *   DATABASE_URL=mysql://root@127.0.0.1:3420/technova AUTH_SECRET=<copy secret> npx tsx scripts/security/idor-probe.ts http://127.0.0.1:3100
 *
 * Local copies only (refuses any other address). Read-only: GET requests, nothing is changed.
 */

import { PrismaClient } from '@prisma/client'
import { encode } from 'next-auth/jwt'

const BASE = process.argv[2] ?? 'http://127.0.0.1:3100'
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) { console.error('Refusing: local copies only.'); process.exit(1) }
const SECRET = process.env.AUTH_SECRET ?? ''
const p = new PrismaClient()

async function cookie(u: { id: string; email: string; role: string }) {
  const t = await encode({ token: { sub: u.id, id: u.id, email: u.email, role: u.role, campusId: null, loginAt: Date.now(), twoFactorSetup: false }, secret: SECRET, salt: 'authjs.session-token', maxAge: 3600 })
  return `authjs.session-token=${t}; tn-lang=en`
}

type Hit = { who: string; path: string; status: number; leak: boolean; size: number }

async function probe(who: string, c: string, path: string): Promise<Hit> {
  const r = await fetch(BASE + path, { headers: { cookie: c }, redirect: 'manual' })
  const text = await r.text()
  // a 200 that carries real data (not an empty list / success:false) counts as a leak
  let leak = r.status === 200
  if (leak) {
    try {
      const j = JSON.parse(text)
      const d = j?.data ?? j
      if (j?.success === false || d == null || (Array.isArray(d) && d.length === 0) || (Array.isArray(d?.items) && d.items.length === 0)) leak = false
    } catch { leak = !/sign in|login|not allowed|forbidden/i.test(text) && text.length > 200 }
  }
  return { who, path, status: r.status, leak, size: text.length }
}

async function main() {
  // family A (the prober) and family B (the target), by the phones in D:\TechNova-Tests\accounts.md
  const gA = await p.guardian.findFirstOrThrow({ where: { phoneNumber: '01001234561' }, select: { userId: true } })
  const gB = await p.guardian.findFirstOrThrow({ where: { phoneNumber: '01112345672' }, select: { id: true, userId: true, students: { select: { id: true, userId: true } } } })
  const userA = await p.user.findUniqueOrThrow({ where: { id: gA.userId }, select: { id: true, email: true, role: true } })
  const kidB = gB.students[0]
  const studentA = await p.student.findFirstOrThrow({ where: { registrationNumber: 'TN/2026/0001' }, select: { userId: true } })
  const studentUserA = await p.user.findUniqueOrThrow({ where: { id: studentA.userId }, select: { id: true, email: true, role: true } })
  const teacherU = await p.user.findFirstOrThrow({ where: { email: 'ahmed.youssef@technova-egypt.com' }, select: { id: true, email: true, role: true } })
  const teacher = await p.teacher.findFirstOrThrow({ where: { userId: teacherU.id }, select: { id: true } })

  const invB = await p.feeInvoice.findFirst({ where: { studentId: kidB.id }, select: { id: true } })
  const payB = await p.feePayment.findFirst({ where: { invoice: { studentId: kidB.id } }, select: { id: true } })
  const certB = await p.certificate.findFirst({ where: { studentId: kidB.id }, select: { id: true } }).catch(() => null)
  const repB = await p.sessionReport.findFirst({ where: { students: { some: { studentId: kidB.id } } }, select: { id: true } }).catch(() => null)
  const cmpB = await p.complaint.findFirst({ where: { NOT: { complainantId: userA.id } }, select: { id: true } }).catch(() => null)
  const topB = await p.walletTopUp.findFirst({ where: { studentId: kidB.id }, select: { id: true } }).catch(() => null)
  // a group the instructor does NOT teach
  const otherGroup = await p.classSection.findFirst({ where: { status: 'ACTIVE', subjectOfferings: { none: { teacherId: teacher.id } } }, select: { id: true } })
  const otherKid = otherGroup ? await p.studentEnrollment.findFirst({ where: { classSectionId: otherGroup.id, status: 'ACTIVE' }, select: { studentId: true } }) : null

  const s = kidB.id
  const kidPaths = [
    `/api/students/${s}`, `/api/students/${s}/fees`, `/api/students/${s}/wallet`, `/api/students/${s}/wallet/statement`,
    `/api/students/${s}/attendance-timeline`, `/api/students/${s}/timeline`, `/api/students/${s}/reports`, `/api/students/${s}/session-reports`,
    `/api/students/${s}/upcoming-sessions`, `/api/students/${s}/guardians`, `/api/students/${s}/contacts`, `/api/students/${s}/enrollments`,
    `/api/students/${s}/next-level`, `/api/students/${s}/watch`, `/api/students/${s}/birthday-card`, `/api/students/${s}/marketing`,
    `/api/guardian-portal/children/${s}/academic`, `/api/guardian-portal/children/${s}/monitoring`, `/api/guardian-portal/children/${s}/leaves`,
    `/api/guardian/wards/${s}/academics`, `/api/guardian/wards/${s}/attendance`, `/api/guardian/wards/${s}/fees`,
    `/api/passport/${s}`, `/api/passport/${s}/print`, `/api/passport/${s}/share`, `/api/profile/${s}`, `/api/fees?studentId=${s}`,
    `/api/students/${s}/fees?format=xlsx`,
    ...(invB ? [`/api/fees/${invB.id}`, `/api/fees/${invB.id}/payments`, `/api/guardian/wards/${s}/fees/${invB.id}`, `/api/accountant/fees/invoices/${invB.id}`] : []),
    ...(payB ? [`/api/payments/${payB.id}/receipt`] : []),
    ...(certB ? [`/api/certificates/print/${certB.id}`] : []),
    ...(repB ? [`/api/session-reports/${repB.id}`] : []),
    ...(cmpB ? [`/api/complaints/${cmpB.id}`] : []),
    ...(topB ? [`/api/wallet/topups/${topB.id}`] : []),
  ]
  const hits: Hit[] = []
  const cA = await cookie(userA), cS = await cookie(studentUserA), cT = await cookie(teacherU)
  for (const path of kidPaths) hits.push(await probe('parent A', cA, path))
  for (const path of kidPaths) hits.push(await probe('student A', cS, path))
  if (otherGroup) {
    const tPaths = [
      `/api/groups/${otherGroup.id}`, `/api/groups/${otherGroup.id}/students`, `/api/groups/${otherGroup.id}/lessons`,
      `/api/groups/${otherGroup.id}/assignments`, `/api/groups/${otherGroup.id}/quizzes`, `/api/enrollment-attendance/roster?classSectionId=${otherGroup.id}&date=2026-11-10`,
      `/api/teacher-portal/sections/${otherGroup.id}/students`, ...(otherKid ? [`/api/students/${otherKid.studentId}`, `/api/students/${otherKid.studentId}/fees`, `/api/passport/${otherKid.studentId}`] : []),
    ]
    for (const path of tPaths) hits.push(await probe('instructor', cT, path))
  }
  // staff-only lists a parent must never read
  for (const path of ['/api/students?limit=5', '/api/users?limit=5', '/api/fees?limit=5', '/api/guardians?limit=5', '/api/treasury', '/api/teachers', '/api/audit?limit=5', '/api/data/students/export', '/api/admin/backups'])
    hits.push(await probe('parent A', cA, path))

  // staff roles asking for what their role must not see (money, salaries, permissions, backups, other places)
  const secU = await p.user.findFirstOrThrow({ where: { email: 'nourhan@technova-egypt.com' }, select: { id: true, email: true, role: true } })
  const cSec = await cookie(secU)
  const adminOnly = ['/api/admin/backups', '/api/audit-logs?limit=5', '/api/permissions/matrix', '/api/business-growth', '/api/salary-slips?limit=5', '/api/treasury', '/api/finance/cashflow', '/api/month-close', '/api/security/settings', '/api/admin/login-locks', '/api/data/payments/export', '/api/users?limit=5']
  for (const path of adminOnly) hits.push(await probe('instructor', cT, path))
  for (const path of adminOnly) hits.push(await probe('secretary', cSec, path))

  const leaks = hits.filter((h) => h.leak)
  for (const h of hits) console.log(`${h.leak ? 'LEAK ' : 'ok   '} ${h.status} ${h.who.padEnd(10)} ${h.path} (${h.size} b)`)
  console.log(`\n${hits.length} checks, ${leaks.length} possible leaks`)
  await p.$disconnect()
}

main().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1) })
