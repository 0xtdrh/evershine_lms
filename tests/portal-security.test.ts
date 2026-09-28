import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  guardian: { findUnique: vi.fn(), findFirst: vi.fn() },
  student: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { DEFAULT_PERMISSION_MATRIX } from '@/lib/rbac'
import { isDefaultPortalPassword, looksLikePhone, phoneVariants, resolveLoginEmail } from '@/lib/portal-login'

describe('portal roles have no staff-level permissions', () => {
  const allowed: Record<string, string[]> = {
    GUARDIAN: ['announcements:read', 'calendar:read', 'campuses:read', 'dashboard:read'],
    PARENT: ['announcements:read', 'calendar:read', 'campuses:read', 'dashboard:read'],
    STUDENT: ['announcements:read', 'calendar:read', 'campuses:read', 'dashboard:read', 'exams:read', 'leaves:create'],
  }
  for (const [role, expected] of Object.entries(allowed)) {
    it(`${role} has exactly ${expected.length} permissions`, () => {
      const actual = Object.entries(DEFAULT_PERMISSION_MATRIX[role as keyof typeof DEFAULT_PERMISSION_MATRIX])
        .flatMap(([resource, actions]) => (actions as string[]).map((a) => `${resource}:${a}`))
        .sort()
      expect(actual).toEqual([...expected].sort())
    })
  }
})

describe('phone login helpers', () => {
  it('recognises Egyptian phone formats', () => {
    expect(phoneVariants('+20 101 234 5678')).toContain('01012345678')
    expect(phoneVariants('01012345678')).toEqual(expect.arrayContaining(['+201012345678', '201012345678']))
    expect(looksLikePhone('01012345678')).toBe(true)
    expect(looksLikePhone('parent@example.com')).toBe(false)
  })

  it('resolves a phone number to the guardian account email', async () => {
    prismaMock.guardian.findFirst.mockResolvedValueOnce({ user: { email: 'guardian_01012345678@technova.local' } })
    expect(await resolveLoginEmail('+201012345678')).toBe('guardian_01012345678@technova.local')
    expect(await resolveLoginEmail('Admin@Example.com')).toBe('admin@example.com')
  })
})

describe('default portal passwords never open an account', () => {
  beforeEach(() => vi.clearAllMocks())

  it('guardian: the phone number (any format) is a default password', async () => {
    prismaMock.guardian.findUnique.mockResolvedValue({ phoneNumber: '01012345678' })
    expect(await isDefaultPortalPassword('u1', 'GUARDIAN', '01012345678')).toBe(true)
    expect(await isDefaultPortalPassword('u1', 'GUARDIAN', '+201012345678')).toBe(true)
    expect(await isDefaultPortalPassword('u1', 'GUARDIAN', 'MyOwn!Pass9')).toBe(false)
  })

  it('student: Student@YYYY!, TN+last4 and the registration number are default passwords', async () => {
    prismaMock.student.findUnique.mockResolvedValue({ registrationNumber: 'TN/2026/0042' })
    expect(await isDefaultPortalPassword('u2', 'STUDENT', 'Student@2026!')).toBe(true)
    expect(await isDefaultPortalPassword('u2', 'STUDENT', 'TN0042')).toBe(true)
    expect(await isDefaultPortalPassword('u2', 'STUDENT', 'TN20260042')).toBe(true)
    expect(await isDefaultPortalPassword('u2', 'STUDENT', 'Secret123A')).toBe(false)
  })

  it('staff roles are not affected', async () => {
    expect(await isDefaultPortalPassword('u3', 'ADMIN', '01012345678')).toBe(false)
  })
})
