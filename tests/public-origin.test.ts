import { describe, expect, it } from 'vitest'
import { publicOrigin } from '@/lib/http/origin'

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null })

describe('publicOrigin (redirects behind a proxy)', () => {
  it('uses the proxy forwarded host and protocol', () => {
    expect(publicOrigin(h({ 'x-forwarded-host': 'technovafuture.com', 'x-forwarded-proto': 'https', host: '0.0.0.0:3000' }), 'http://0.0.0.0:3000')).toBe('https://technovafuture.com')
  })
  it('uses the Host header when there is no proxy header, https for a real domain', () => {
    expect(publicOrigin(h({ host: 'technovafuture.com' }), 'http://0.0.0.0:3000')).toBe('https://technovafuture.com')
  })
  it('keeps http for localhost', () => {
    expect(publicOrigin(h({ host: 'localhost:3100' }), 'http://0.0.0.0:3100')).toBe('http://localhost:3100')
  })
  it('never returns the bind address: falls back to the configured public URL', () => {
    expect(publicOrigin(h({ host: '0.0.0.0:3000' }), 'http://0.0.0.0:3000', { NEXTAUTH_URL: 'https://technovafuture.com/' })).toBe('https://technovafuture.com')
  })
  it('first value of a forwarded list, and ignores a strange host', () => {
    expect(publicOrigin(h({ 'x-forwarded-host': 'a.example.com, b.internal', 'x-forwarded-proto': 'https,http' }), 'x')).toBe('https://a.example.com')
    expect(publicOrigin(h({ host: 'evil.com/path' }), 'http://fallback:1')).toBe('http://fallback:1')
  })
})
