/**
 * Security part 2 (2026-11-06): two-step sign-in, server side. Rules: lib/security/totp.ts.
 * The app secret is stored sealed (AES-GCM with the signing secret), the spare codes only as hashes.
 */

import crypto from 'crypto'
import QRCode from 'qrcode'
import { prisma } from '@/lib/prisma'
import { forgetSessionState } from '@/lib/session-guard'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { signingSecret } from './secret'
import { securityAlert } from './alerts'
import { cleanSecuritySettings, DEFAULT_SECURITY_SETTINGS, hashRecovery, newRecoveryCodes, newSecret, otpauthUrl, twoFactorNeed, verifyCode, type SecuritySettings } from './totp'

const KEY = 'security.settings'
export const getSecuritySettings = async () => cleanSecuritySettings(await getSetting<Partial<SecuritySettings>>(KEY, DEFAULT_SECURITY_SETTINGS))
export async function saveSecuritySettings(v: Partial<SecuritySettings>, userId: string) {
  const before = await getSecuritySettings()
  const next = cleanSecuritySettings({ ...before, ...v })
  await setSetting(KEY, next, userId)
  if (before.twoFactorEnabled && !next.twoFactorEnabled) await securityAlert('PERMISSIONS', { actorId: userId, text: 'Two-step sign-in was switched OFF', textAr: 'التحقق بخطوتين اتقفل' })
  return next
}

const sealKey = () => crypto.createHash('sha256').update(`totp:${signingSecret()}`).digest()
function seal(s: string) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', sealKey(), iv)
  const out = Buffer.concat([c.update(s, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), out].map((b) => b.toString('base64')).join('.')
}
function unseal(v: string) {
  const [iv, tag, out] = v.split('.').map((x) => Buffer.from(x, 'base64'))
  const d = crypto.createDecipheriv('aes-256-gcm', sealKey(), iv); d.setAuthTag(tag)
  return Buffer.concat([d.update(out), d.final()]).toString('utf8')
}

const fields = { id: true, email: true, role: true, totpSecret: true, totpEnabledAt: true, totpRecovery: true, totpLastStep: true } as const

export async function myStatus(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: fields })
  if (!u) return null
  const s = await getSecuritySettings()
  return { enabled: !!u.totpEnabledAt, required: s.twoFactorEnabled && s.twoFactorRoles.includes(u.role), companyOn: s.twoFactorEnabled, sparesLeft: u.totpRecovery ? (JSON.parse(u.totpRecovery) as string[]).length : 0 }
}

/** A new secret (not active until a code from the app confirms it). */
export async function startSetup(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: fields })
  if (!u) throw new Error('User not found')
  if (u.totpEnabledAt) throw new Error('Two-step sign-in is already on · التحقق بخطوتين شغال أصلًا')
  const secret = newSecret()
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: seal(secret), totpLastStep: null } })
  const url = otpauthUrl(secret, u.email)
  return { secret, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 240 }) }
}

/** The first code from the app turns it on; the spare codes are shown once; every session signs out (sign in again with a code). */
export async function confirmSetup(userId: string, code: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: fields })
  if (!u?.totpSecret || u.totpEnabledAt) throw new Error('Start again · ابدأ من الأول')
  const step = verifyCode(unseal(u.totpSecret), code, Date.now(), null)
  if (step == null) throw new Error('The code is not right. Check the time on the phone · الكود غلط، راجع الساعة في الموبايل')
  const spares = newRecoveryCodes()
  await prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date(), totpLastStep: step, totpRecovery: JSON.stringify(spares.map(hashRecovery)), sessionsRevokedAt: new Date() } })
  forgetSessionState(userId) // sign out now, not after the 30 s cache
  return { spares }
}

/** At sign-in: is this code (or a spare code) right? Uses the code up. */
export async function checkSignInCode(userId: string, code: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: fields })
  if (!u?.totpSecret || !u.totpEnabledAt) return false
  const step = verifyCode(unseal(u.totpSecret), code, Date.now(), u.totpLastStep)
  if (step != null) {
    const r = await prisma.user.updateMany({ where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } })
    return r.count === 1
  }
  const spares = u.totpRecovery ? (JSON.parse(u.totpRecovery) as string[]) : []
  const h = hashRecovery(code)
  if (!spares.includes(h)) return false
  await prisma.user.update({ where: { id: userId }, data: { totpRecovery: JSON.stringify(spares.filter((x) => x !== h)) } })
  await securityAlert('ADMIN_RESET', { actorId: userId, text: `A spare two-step code was used (${spares.length - 1} left)`, textAr: `اتستخدم كود احتياطي للتحقق بخطوتين (باقي ${spares.length - 1})` })
  return true
}

/** What sign-in needs from this account. */
export async function signInNeed(userId: string, role: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true } })
  return twoFactorNeed(await getSecuritySettings(), role, !!u?.totpEnabledAt)
}

/** Turn it off for an account (a lost phone): only a Super Admin, never silently. The person sets it up again at the next sign-in if required. */
export async function resetTwoFactor(targetId: string, actorId: string) {
  const u = await prisma.user.findUnique({ where: { id: targetId }, select: { email: true } })
  if (!u) throw new Error('User not found')
  await prisma.user.update({ where: { id: targetId }, data: { totpSecret: null, totpEnabledAt: null, totpRecovery: null, totpLastStep: null, sessionsRevokedAt: new Date() } })
  forgetSessionState(targetId)
  await securityAlert('ADMIN_RESET', { actorId, text: `Two-step sign-in was reset for ${u.email}`, textAr: `التحقق بخطوتين اتلغى لحساب ${u.email}` })
}

/** Staff accounts and whether each one has it on. */
export async function staffStatus() {
  const s = await getSecuritySettings()
  const rows = await prisma.user.findMany({ where: { isActive: true, role: { notIn: ['STUDENT', 'PARENT', 'GUARDIAN'] } }, select: { id: true, email: true, role: true, totpEnabledAt: true, lastLogin: true }, orderBy: [{ role: 'asc' }, { email: 'asc' }], take: 500 })
  return rows.map((r) => ({ ...r, required: s.twoFactorEnabled && s.twoFactorRoles.includes(r.role) }))
}
