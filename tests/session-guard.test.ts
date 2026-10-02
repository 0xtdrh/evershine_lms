import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ user: { findUnique: vi.fn(), update: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { forgetSessionState, guardSession } from '@/lib/session-guard'

const session = (over: Record<string, unknown> = {}) => ({
  user: { id: 'u1', role: 'SECRETARY' as const, loginAt: 1_000, ...over },
  expires: '',
})

beforeEach(() => {
  vi.clearAllMocks()
  forgetSessionState('u1')
})

describe('guardSession', () => {
  it('keeps an active account unchanged', async () => {
    db.user.findUnique.mockResolvedValue({ isActive: true, role: 'SECRETARY', sessionsRevokedAt: null })
    const s = session()
    expect(await guardSession(s)).toBe(s)
  })

  it('signs out a deactivated account', async () => {
    db.user.findUnique.mockResolvedValue({ isActive: false, role: 'SECRETARY', sessionsRevokedAt: null })
    expect(await guardSession(session())).toBeNull()
  })

  it('signs out a deleted account', async () => {
    db.user.findUnique.mockResolvedValue(null)
    expect(await guardSession(session())).toBeNull()
  })

  it('signs out sessions older than a password change', async () => {
    db.user.findUnique.mockResolvedValue({ isActive: true, role: 'SECRETARY', sessionsRevokedAt: new Date(2_000) })
    expect(await guardSession(session({ loginAt: 1_000 }))).toBeNull()
  })

  it('keeps a session that signed in after the password change', async () => {
    db.user.findUnique.mockResolvedValue({ isActive: true, role: 'SECRETARY', sessionsRevokedAt: new Date(2_000) })
    expect(await guardSession(session({ loginAt: 3_000 }))).not.toBeNull()
  })

  it('treats sessions from before this feature (no loginAt) as old', async () => {
    db.user.findUnique.mockResolvedValue({ isActive: true, role: 'SECRETARY', sessionsRevokedAt: new Date(2_000) })
    expect(await guardSession(session({ loginAt: undefined }))).toBeNull()
  })

  it('uses the current role when it changed', async () => {
    db.user.findUnique.mockResolvedValue({ isActive: true, role: 'TEACHER', sessionsRevokedAt: null })
    const out = await guardSession(session())
    expect(out?.user.role).toBe('TEACHER')
  })

  it('never signs anyone out because of a database error', async () => {
    db.user.findUnique.mockRejectedValue(new Error('db down'))
    const s = session()
    expect(await guardSession(s)).toBe(s)
  })

  it('caches the lookup for a short time', async () => {
    db.user.findUnique.mockResolvedValue({ isActive: true, role: 'SECRETARY', sessionsRevokedAt: null })
    await guardSession(session())
    await guardSession(session())
    expect(db.user.findUnique).toHaveBeenCalledTimes(1)
  })

  it('passes through when there is no session', async () => {
    expect(await guardSession(null)).toBeNull()
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })
})
