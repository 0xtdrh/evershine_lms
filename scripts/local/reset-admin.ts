/** Local copy only (start-local.ps1 -ResetAdmin): sets a Super Admin's password. The password comes from the person typing it, never a file. */

import { prisma } from '../../lib/prisma'
import { hash } from '@node-rs/argon2'
import { passwordProblem } from '../../lib/security/password-policy'

async function main() {
  const email = (process.env.TN_EMAIL ?? '').trim().toLowerCase()
  const pw = process.env.TN_NEW_PW ?? ''
  if (!/@/.test(email)) throw new Error('Write the Super Admin email')
  if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? '')) throw new Error('This only runs on the local database')
  const weak = passwordProblem('SUPER_ADMIN', pw)
  if (weak) throw new Error(weak.en)
  const u = await prisma.user.findFirst({ where: { email, role: 'SUPER_ADMIN' }, select: { id: true } })
  if (!u) throw new Error('No Super Admin with that email in the local data')
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hash(pw), mustChangePassword: false, sessionsRevokedAt: new Date() } })
  await prisma.loginAttempt.deleteMany({ where: { identifier: { contains: email } } })
  console.log('[local] password set for', email)
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error('[local]', e.message); await prisma.$disconnect(); process.exit(1) })
