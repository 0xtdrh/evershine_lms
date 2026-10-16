import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockAuth, mockCreate, mockAudit } = vi.hoisted(() => ({ mockAuth: vi.fn(), mockCreate: vi.fn(), mockAudit: vi.fn() }))

vi.mock('@/lib/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/audit-logger', () => ({ logAudit: mockAudit }))
vi.mock('@/lib/announcements/engine', () => ({
  AnnouncementError: class AnnouncementError extends Error {},
  createAnnouncement: mockCreate,
  feedFor: vi.fn(async () => []),
  manageList: vi.fn(async () => []),
}))

import { POST } from '../app/api/announcements/route'

const payload = { title: 'Fee reminder', body: 'Please pay before Thursday', audiences: ['PARENT'], scopeType: 'COMPANY', scopeIds: [] }
const post = (b: unknown) => POST(new NextRequest('http://localhost/api/announcements', { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } }))

describe('POST /api/announcements (5-D)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'Super Admin' } })
    mockCreate.mockResolvedValue({ id: 'a1', title: payload.title, audiences: 'PARENT', scopeType: 'COMPANY', status: 'PUBLISHED' })
    mockAudit.mockResolvedValue(undefined)
  })

  it('Super Admin (display role alias) sends; the engine gets the targeted draft', async () => {
    const r = await post(payload)
    expect(r.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith({ id: 'admin-1', role: 'SUPER_ADMIN' }, expect.objectContaining({ audiences: ['PARENT'], scopeType: 'COMPANY' }))
  })

  it('students cannot send', async () => {
    mockAuth.mockResolvedValue({ user: { id: 's1', role: 'STUDENT' } })
    expect((await post(payload)).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('no audience or an unknown scope is refused', async () => {
    expect((await post({ ...payload, audiences: [] })).status).toBe(400)
    expect((await post({ ...payload, scopeType: 'PLANET' })).status).toBe(400)
  })
})
