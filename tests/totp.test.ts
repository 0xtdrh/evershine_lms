import { describe, expect, it } from 'vitest'
import { base32Decode, base32Encode, cleanSecuritySettings, codeAt, hashRecovery, newRecoveryCodes, otpauthUrl, stepOf, twoFactorNeed, verifyCode } from '@/lib/security/totp'

// RFC 6238 test secret "12345678901234567890" (ASCII)
const RFC = base32Encode(Buffer.from('12345678901234567890'))

describe('app codes', () => {
  it('matches the RFC 6238 examples (last 6 digits)', () => {
    expect(RFC).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    expect(codeAt(RFC, stepOf(59_000))).toBe('287082')
    expect(codeAt(RFC, stepOf(1_111_111_109_000))).toBe('081804')
    expect(codeAt(RFC, stepOf(2_000_000_000_000))).toBe('279037')
  })
  it('base32 goes both ways', () => {
    expect(base32Decode(RFC).toString()).toBe('12345678901234567890')
  })
  it('accepts the step before and after, not further', () => {
    const now = 1_111_111_109_000, s = stepOf(now)
    expect(verifyCode(RFC, codeAt(RFC, s), now, null)).toBe(s)
    expect(verifyCode(RFC, codeAt(RFC, s - 1), now, null)).toBe(s - 1)
    expect(verifyCode(RFC, codeAt(RFC, s + 1), now, null)).toBe(s + 1)
    expect(verifyCode(RFC, codeAt(RFC, s - 2), now, null)).toBeNull()
  })
  it('a code already used is refused', () => {
    const now = 1_111_111_109_000, s = stepOf(now)
    expect(verifyCode(RFC, codeAt(RFC, s), now, s)).toBeNull()
    expect(verifyCode(RFC, codeAt(RFC, s - 1), now, s - 1)).toBeNull()
  })
  it('wrong or short codes are refused', () => {
    expect(verifyCode(RFC, '000000', 59_000, null)).toBeNull()
    expect(verifyCode(RFC, '12345', 59_000, null)).toBeNull()
    expect(verifyCode(RFC, '287 082', 59_000, null)).toBe(1)
  })
  it('the QR link names TechNova and the account', () => {
    expect(otpauthUrl(RFC, 'a@b.c')).toContain('otpauth://totp/TechNova%3Aa%40b.c?secret=' + RFC)
  })
})

describe('spare codes', () => {
  it('eight different codes, stored as hashes that ignore case and dashes', () => {
    const c = newRecoveryCodes()
    expect(new Set(c).size).toBe(8)
    expect(hashRecovery(c[0])).toBe(hashRecovery(c[0].toLowerCase().replace('-', '')))
  })
})

describe('settings and what sign-in needs', () => {
  it('on by default for Super Admin and Admin, 30 minutes idle', () => {
    expect(cleanSecuritySettings(null)).toEqual({ twoFactorEnabled: true, twoFactorRoles: ['SUPER_ADMIN', 'ADMIN'], idleMinutes: 30 })
    expect(cleanSecuritySettings({ twoFactorRoles: ['ADMIN', 'PARENT', 'ADMIN'] }).twoFactorRoles).toEqual(['ADMIN'])
    expect(cleanSecuritySettings({ idleMinutes: -3 }).idleMinutes).toBe(30)
  })
  it('switched off: nobody is asked', () => {
    const off = cleanSecuritySettings({ twoFactorEnabled: false })
    expect(twoFactorNeed(off, 'SUPER_ADMIN', true)).toBe('NONE')
  })
  it('a required role sets it up; once on, everyone with it gives a code', () => {
    const on = cleanSecuritySettings(null)
    expect(twoFactorNeed(on, 'ADMIN', false)).toBe('SETUP')
    expect(twoFactorNeed(on, 'SECRETARY', false)).toBe('NONE')
    expect(twoFactorNeed(on, 'SECRETARY', true)).toBe('CODE')
  })
})
