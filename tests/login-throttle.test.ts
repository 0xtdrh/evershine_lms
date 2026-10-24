import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { lockEndsAt } from '@/lib/login-throttle'

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0)
const minsAgo = (...m: number[]) => m.map((x) => new Date(NOW - x * 60_000))

describe('lockEndsAt', () => {
  it('is not locked with fewer failures than the limit', () => {
    expect(lockEndsAt(minsAgo(0, 1, 2, 3), 5, NOW)).toBeNull()
  })

  it('locks for 15 minutes from the LAST failure, even when typed slowly', () => {
    // 5 wrong passwords over 12 minutes: still locked 15 min after the 5th.
    const until = lockEndsAt(minsAgo(0, 3, 6, 9, 12), 5, NOW)
    expect(until?.getTime()).toBe(NOW + 15 * 60_000)
  })

  it('is still locked 14 minutes after the last failure', () => {
    expect(lockEndsAt(minsAgo(14, 17, 20, 23, 26), 5, NOW)).not.toBeNull()
  })

  it('unlocks 15 minutes after the last failure', () => {
    expect(lockEndsAt(minsAgo(15, 16, 17, 18, 19), 5, NOW)).toBeNull()
  })

  it('does not lock when the failures are spread over more than 15 minutes', () => {
    expect(lockEndsAt(minsAgo(0, 5, 10, 15, 20), 5, NOW)).toBeNull()
  })
})

describe('students sign in with their registration number (2026-10-24)', () => {
  it('reads every common way of typing it', async () => {
    const { registrationFromLogin } = await import('@/lib/portal-login')
    expect(registrationFromLogin('TN/2026/0001')).toBe('TN/2026/0001')
    expect(registrationFromLogin('tn-2026-0001')).toBe('TN/2026/0001')
    expect(registrationFromLogin(' TN.2026.12 ')).toBe('TN/2026/0012')
    expect(registrationFromLogin('TN20260001')).toBe('TN/2026/0001')
    expect(registrationFromLogin('01000000201')).toBeNull()
    expect(registrationFromLogin('a@b.com')).toBeNull()
  })
})

describe('easy student login name (2026-10-24)', () => {
  it('English first name + the registration number, letters only', async () => {
    const { studentLoginName, loginNameParts } = await import('@/lib/portal-login')
    expect(studentLoginName('Youssef', 'TN/2026/0001')).toBe('youssef0001')
    expect(studentLoginName('Abd El-Rahman', 'TN/2026/0042')).toBe('abdelrahman0042')
    expect(studentLoginName('يوسف', 'TN/2026/0001')).toBeNull()
    expect(loginNameParts('Youssef0001')).toEqual({ name: 'youssef', num: '0001' })
    expect(loginNameParts('youssef')).toBeNull()
    expect(loginNameParts('01000000201')).toBeNull()
  })
})
