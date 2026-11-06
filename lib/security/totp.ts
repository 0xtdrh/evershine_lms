/**
 * Security part 2 (2026-11-06): six-digit codes from an authenticator app (Google Authenticator, Microsoft Authenticator…),
 * RFC 6238 / RFC 4226 with SHA-1, 30-second steps. Pure node crypto (tests/totp.test.ts).
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const STEP_SECONDS = 30

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch); bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

export const newSecret = () => base32Encode(randomBytes(20))

/** The code for one 30-second step. */
export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const off = mac[mac.length - 1] & 15
  const n = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]
  return String(n % 1_000_000).padStart(6, '0')
}

export const stepOf = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS)

/**
 * The step the code belongs to, or null. One step either side is accepted (a phone clock a little off). A step already used
 * (lastStep) is refused, so a code seen over someone's shoulder cannot be used again.
 */
export function verifyCode(secret: string, code: string, nowMs: number, lastStep: number | null): number | null {
  const c = String(code ?? '').replace(/\D/g, '')
  if (c.length !== 6) return null
  const now = stepOf(nowMs)
  for (const s of [now, now - 1, now + 1]) {
    if (lastStep != null && s <= lastStep) continue
    const want = Buffer.from(codeAt(secret, s)), got = Buffer.from(c)
    if (timingSafeEqual(want, got)) return s
  }
  return null
}

/** The link the app reads from the QR code. */
export function otpauthUrl(secret: string, account: string, issuer = 'TechNova'): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`
}

/** Spare codes for a lost phone: shown once, stored only as hashes. */
export function newRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => { const h = randomBytes(5).toString('hex').toUpperCase(); return `${h.slice(0, 5)}-${h.slice(5)}` })
}
export const hashRecovery = (code: string) => createHash('sha256').update(code.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex')

/** Settings: on / off for the company, which roles must use it, minutes of no use before staff are signed out (0 = never). */
export interface SecuritySettings { twoFactorEnabled: boolean; twoFactorRoles: string[]; idleMinutes: number }
export const TWO_FACTOR_ROLE_CHOICES = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'SECRETARY', 'MARKETING', 'TEACHER']
export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = { twoFactorEnabled: true, twoFactorRoles: ['SUPER_ADMIN', 'ADMIN'], idleMinutes: 30 }

export function cleanSecuritySettings(v: Partial<SecuritySettings> | null | undefined): SecuritySettings {
  const roles = Array.isArray(v?.twoFactorRoles) ? v!.twoFactorRoles.filter((r) => TWO_FACTOR_ROLE_CHOICES.includes(r)) : DEFAULT_SECURITY_SETTINGS.twoFactorRoles
  const idle = Math.round(Number(v?.idleMinutes))
  return {
    twoFactorEnabled: typeof v?.twoFactorEnabled === 'boolean' ? v.twoFactorEnabled : DEFAULT_SECURITY_SETTINGS.twoFactorEnabled,
    twoFactorRoles: [...new Set(roles)],
    idleMinutes: idle >= 0 && idle <= 720 ? idle : DEFAULT_SECURITY_SETTINGS.idleMinutes,
  }
}

/** What sign-in needs from this person: nothing, a code, or setting the app up first. */
export function twoFactorNeed(s: SecuritySettings, role: string, enrolled: boolean): 'NONE' | 'CODE' | 'SETUP' {
  if (!s.twoFactorEnabled) return 'NONE'
  if (enrolled) return 'CODE'
  return s.twoFactorRoles.includes(role) ? 'SETUP' : 'NONE'
}
