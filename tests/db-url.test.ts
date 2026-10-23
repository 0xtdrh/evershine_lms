import { describe, expect, it } from 'vitest'
import { withPoolLimits } from '@/lib/db-url'

describe('database pool limits (2026-10-24)', () => {
  it('Vercel: small pool added after the existing query', () => {
    expect(withPoolLimits('mysql://u:p@h:3306/db?sslaccept=accept_invalid_certs', { VERCEL: '1' }))
      .toBe('mysql://u:p@h:3306/db?sslaccept=accept_invalid_certs&connection_limit=3&pool_timeout=20')
  })
  it('other hosts: default 5; env overrides', () => {
    expect(withPoolLimits('mysql://u:p@h/db', {})).toBe('mysql://u:p@h/db?connection_limit=5&pool_timeout=20')
    expect(withPoolLimits('mysql://u:p@h/db', { DB_CONNECTION_LIMIT: '10', DB_POOL_TIMEOUT: '30' })).toBe('mysql://u:p@h/db?connection_limit=10&pool_timeout=30')
  })
  it('a URL that already sets connection_limit is kept', () => {
    expect(withPoolLimits('mysql://u:p@h/db?connection_limit=7', { VERCEL: '1' })).toBe('mysql://u:p@h/db?connection_limit=7')
  })
})
