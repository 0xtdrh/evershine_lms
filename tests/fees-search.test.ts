import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockAuth, mockPrisma, count, findMany } = vi.hoisted(() => {
  const count = vi.fn(() => 'COUNT')
  const findMany = vi.fn(() => 'ROWS')
  const mockPrisma = {
    feeInvoice: { count, findMany },
    $transaction: vi.fn(async () => [0, []]),
  }
  return { mockAuth: vi.fn(), mockPrisma, count, findMany }
})

vi.mock('@/lib/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/rbac', () => ({ checkPermission: () => true }))
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/places/server', () => ({ requestPlaces: vi.fn(async () => ({})), invoiceWhere: () => ({ campusId: 'c1' }) }))
vi.mock('@/lib/academic/engine', () => ({ getActiveAcademicYear: vi.fn(async () => null) }))
vi.mock('@/lib/fees/payment-settings', () => ({ paymentAccountsSnapshot: vi.fn() }))

import { GET } from '../app/api/fees/route'

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/fees?${qs}`))

describe('GET /api/fees search (final test 18/11: searched on the server, not the 20 rows of the page)', () => {
  beforeEach(() => { vi.clearAllMocks(); mockAuth.mockResolvedValue({ user: { id: 'u1', role: 'ACCOUNTANT' } }) })

  it('a search adds invoice number OR student name / registration number, kept inside the place limit', async () => {
    await get('page=1&limit=20&search=رقية')
    const where = (count.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where as { AND: unknown[] }
    expect(where.AND).toHaveLength(2)
    expect(where.AND[0]).toMatchObject({ campusId: 'c1' })
    const or = (where.AND[1] as { OR: unknown[] }).OR
    expect(or[0]).toEqual({ challanNumber: { contains: 'رقية' } })
    const student = (or[1] as { student: { OR: unknown[] } }).student.OR
    expect(student).toContainEqual({ firstName: { contains: 'رقية' } })
    expect(student).toContainEqual({ fullNameAr: { contains: 'رقية' } })
    expect(student).toContainEqual({ registrationNumber: { contains: 'رقية' } })
  })

  it('"first last": every word must match one of the names', async () => {
    await get('search=' + encodeURIComponent('رقية مصطفى'))
    const where = (count.mock.calls[0] as unknown as [{ where: { AND: [unknown, { OR: [unknown, { student: { OR: unknown[] } }] }] } }])[0].where
    const words = where.AND[1].OR[1].student.OR.find((x) => (x as { AND?: unknown }).AND) as { AND: unknown[] }
    expect(words.AND).toHaveLength(2)
  })

  it('no search: the place filter only', async () => {
    await get('page=1')
    const where = (count.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where
    expect(where).toEqual({ campusId: 'c1' })
  })
})
