import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  admissionRequest: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn() },
  student: { findFirst: vi.fn() },
  // In-memory stand-in for the RateLimitHit table (lib/rate-limit-db.ts).
  rateLimitHit: {
    rows: [] as { key: string; createdAt: Date }[],
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/cloudinary', () => ({ uploadProfileImageToCloudinary: vi.fn().mockResolvedValue('https://res.cloudinary.com/x/photo.jpg') }))
vi.mock('@/lib/notifications', () => ({ sendPendingNotification: vi.fn(), sendAdminAdmissionAlert: vi.fn() }))

import { POST } from '@/app/api/admissions/apply/route'

let ipCounter = 0
const form = (over: Record<string, unknown> = {}) => ({
  firstName: 'Omar', lastName: 'Hassan', fullNameAr: 'عمر حسن علي', fatherName: 'Hassan Ali',
  dateOfBirth: '2016-05-10', gender: 'MALE', address: '12 Nasr St, Hurghada', city: 'Hurghada',
  phoneNumber: '01011112222', emergencyContact: '01011113333',
  passportPhotoBase64: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
  guardianFirstName: 'Hassan', guardianLastName: 'Ali', guardianPhoneNumber: '01011112222', guardianRelationship: 'Father',
  termsAccepted: true,
  ...over,
})
const post = (body: unknown, ip = `10.0.0.${++ipCounter}`) =>
  POST(new Request('http://x/api/admissions/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  }))

beforeEach(() => {
  vi.clearAllMocks()
  db.rateLimitHit.rows = []
  db.rateLimitHit.findMany.mockImplementation(async ({ where, take }: { where: { key: string; createdAt: { gte: Date } }; take: number }) =>
    db.rateLimitHit.rows.filter((r) => r.key === where.key && r.createdAt >= where.createdAt.gte).slice(0, take))
  db.rateLimitHit.create.mockImplementation(async ({ data }: { data: { key: string } }) => {
    db.rateLimitHit.rows.push({ key: data.key, createdAt: new Date() })
    return data
  })
  db.rateLimitHit.deleteMany.mockResolvedValue({ count: 0 })
  db.admissionRequest.count.mockResolvedValue(0)
  db.admissionRequest.findFirst.mockResolvedValue(null)
  db.student.findFirst.mockResolvedValue(null)
  db.admissionRequest.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'req-1', createdAt: new Date(), ...data }))
})

describe('public admission form hardening', () => {
  it('accepts a normal application', async () => {
    const res = await post(form())
    expect(res.status).toBe(200)
    expect(db.admissionRequest.create).toHaveBeenCalledTimes(1)
  })

  it('duplicate check uses phone AND first name (a sibling with the same phone is accepted)', async () => {
    await post(form({ firstName: 'Mariam' }))
    expect(db.admissionRequest.findFirst).toHaveBeenCalledWith({
      where: { phoneNumber: '01011112222', firstName: 'Mariam', status: 'PENDING' },
    })
    expect(db.student.findFirst).toHaveBeenCalledWith({ where: { phoneNumber: '01011112222', firstName: 'Mariam' } })
  })

  it('rejects the same child applying twice', async () => {
    db.admissionRequest.findFirst.mockResolvedValue({ id: 'existing' })
    const res = await post(form())
    expect(res.status).toBe(400)
    expect(db.admissionRequest.create).not.toHaveBeenCalled()
  })

  it('invalid date of birth -> 400, not 500', async () => {
    const res = await post(form({ dateOfBirth: 'not-a-date' }))
    expect(res.status).toBe(400)
  })

  it('honeypot filled (bot) -> looks successful but nothing is stored', async () => {
    const res = await post(form({ website: 'http://spam.example' }))
    expect(res.status).toBe(200)
    expect(db.admissionRequest.create).not.toHaveBeenCalled()
  })

  it('more than 5 applications from one IP in an hour -> 429', async () => {
    const statuses = []
    for (let i = 0; i < 6; i++) statuses.push((await post(form({ firstName: `Kid${i}` }), '192.168.9.9')).status)
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
    expect(statuses[5]).toBe(429)
  })

  it('global flood (30 in 10 minutes) -> 429', async () => {
    db.admissionRequest.count.mockResolvedValue(30)
    const res = await post(form())
    expect(res.status).toBe(429)
    expect(db.admissionRequest.create).not.toHaveBeenCalled()
  })
})
