import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  guardian: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn((a) => ({ op: 'guardian.update', a })) },
  user: { findUnique: vi.fn(), update: vi.fn((a) => ({ op: 'user.update', a })) },
  student: { findUnique: vi.fn() },
  auditLog: { create: vi.fn((a) => ({ op: 'audit', a })) },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { changeGuardianPhone, syncGuardianPhonesAfterStudentEdit } from '@/lib/students/guardian-phone'

const G = { id: 'g1', phoneNumber: '01011111111', userId: 'u1', firstName: 'Ahmed', user: { email: 'guardian_01011111111@technova.local' } }

beforeEach(() => vi.clearAllMocks())

describe('changeGuardianPhone', () => {
  it('moves the phone and the auto-generated login email to the new number', async () => {
    db.guardian.findUnique.mockResolvedValue(G)
    db.guardian.findFirst.mockResolvedValue(null)
    db.user.findUnique.mockResolvedValue(null)
    const r = await changeGuardianPhone('g1', '010 2222 2222', 'staff')
    expect(r).toEqual({ ok: true, changed: true })
    expect(db.guardian.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { phoneNumber: '01022222222' } })
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { email: 'guardian_01022222222@technova.local' } })
    expect(db.auditLog.create).toHaveBeenCalled()
  })

  it('keeps a real email untouched', async () => {
    db.guardian.findUnique.mockResolvedValue({ ...G, user: { email: 'dad@gmail.com' } })
    db.guardian.findFirst.mockResolvedValue(null)
    await changeGuardianPhone('g1', '01022222222', 'staff')
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('refuses a number that belongs to another parent (one phone = one parent)', async () => {
    db.guardian.findUnique.mockResolvedValue(G)
    db.guardian.findFirst.mockResolvedValue({ firstName: 'Other', lastName: 'Parent' })
    const r = await changeGuardianPhone('g1', '+201022222222', 'staff')
    expect(r).toMatchObject({ ok: false, reason: 'TAKEN' })
    expect(db.guardian.update).not.toHaveBeenCalled()
  })
})

describe('syncGuardianPhonesAfterStudentEdit', () => {
  it('only the linked parent who had the OLD number follows the change', async () => {
    db.student.findUnique.mockResolvedValue({
      guardians: [
        { id: 'g1', phoneNumber: '01011111111' },
        { id: 'g2', phoneNumber: '01099999999' },
      ],
    })
    db.guardian.findUnique.mockResolvedValue(G)
    db.guardian.findFirst.mockResolvedValue(null)
    db.user.findUnique.mockResolvedValue(null)
    const warnings = await syncGuardianPhonesAfterStudentEdit('s1', [{ from: '+20 101 111 1111', to: '01022222222' }], 'staff')
    expect(warnings).toEqual([])
    expect(db.guardian.update).toHaveBeenCalledTimes(1)
    expect(db.guardian.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { phoneNumber: '01022222222' } })
  })

  it('does nothing when the number did not change', async () => {
    const warnings = await syncGuardianPhonesAfterStudentEdit('s1', [{ from: '01011111111', to: '0101 111 1111' }], 'staff')
    expect(warnings).toEqual([])
    expect(db.student.findUnique).not.toHaveBeenCalled()
  })
})
