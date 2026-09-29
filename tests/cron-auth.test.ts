import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'

const req = (auth?: string) => new Request('https://x/api/cron/db-backup', { headers: auth ? { authorization: auth } : {} })

afterEach(() => vi.unstubAllEnvs())

describe('isAuthorizedCronRequest', () => {
  it('accepts the exact secret', () => {
    vi.stubEnv('CRON_SECRET', 'abc123')
    expect(isAuthorizedCronRequest(req('Bearer abc123'), 't')).toBe(true)
  })

  it('accepts a secret saved with a trailing space/newline (the bug seen on Vercel)', () => {
    vi.stubEnv('CRON_SECRET', 'abc123\n')
    expect(isAuthorizedCronRequest(req('Bearer abc123'), 't')).toBe(true)
    vi.stubEnv('CRON_SECRET', '  abc123 ')
    expect(isAuthorizedCronRequest(req('Bearer abc123'), 't')).toBe(true)
  })

  it('rejects a wrong or missing token, or a missing secret', () => {
    vi.stubEnv('CRON_SECRET', 'abc123')
    expect(isAuthorizedCronRequest(req('Bearer abc124'), 't')).toBe(false)
    expect(isAuthorizedCronRequest(req(), 't')).toBe(false)
    expect(isAuthorizedCronRequest(req('abc123'), 't')).toBe(false)
    vi.stubEnv('CRON_SECRET', '')
    expect(isAuthorizedCronRequest(req('Bearer '), 't')).toBe(false)
  })
})
