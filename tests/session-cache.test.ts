import { describe, expect, it } from 'vitest'
import { forgetSessionState, sessionCache } from '@/lib/session-cache'

describe('session guard memory (final test A05: other devices were signed in 30 s longer)', () => {
  it('forgets one person, or everybody when no id is given', () => {
    sessionCache.set('u1', { at: Date.now(), live: { isActive: true, role: 'SECRETARY', sessionsRevokedAt: null } })
    sessionCache.set('u2', { at: Date.now(), live: { isActive: true, role: 'ADMIN', sessionsRevokedAt: null } })
    forgetSessionState('u1')
    expect(sessionCache.has('u1')).toBe(false)
    expect(sessionCache.has('u2')).toBe(true)
    forgetSessionState()
    expect(sessionCache.size).toBe(0)
  })
})
