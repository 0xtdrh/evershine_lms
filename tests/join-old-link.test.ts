import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/join/[slug]/route'

describe('old /join/<course> link (final test B11: it redirected to 0.0.0.0)', () => {
  it('redirects to the course page on the public address, not the address the server listens on', async () => {
    const req = new NextRequest('http://0.0.0.0:3100/join/nova-explorer', { headers: { host: 'technova.example', 'x-forwarded-proto': 'https' } })
    const res = await GET(req, { params: Promise.resolve({ slug: 'nova-explorer' }) })
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).not.toContain('0.0.0.0')
    expect(res.headers.get('location')).toMatch(/\/courses\/nova-explorer$/)
  })
})
