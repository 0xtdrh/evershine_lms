import { describe, expect, it } from 'vitest'
import { Prisma } from '@prisma/client'
import { diffRecords, sanitize } from '@/lib/audit/auto'

describe('automatic change log (2026-10-18)', () => {
  it('only changed fields, old → new; dates and money as plain values', () => {
    const before = { id: 's1', firstName: 'Omar', phone: '010', fee: new Prisma.Decimal(100), dueDate: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date() }
    const after = { ...before, firstName: 'Omer', fee: new Prisma.Decimal(150), updatedAt: new Date(Date.now() + 1000) }
    expect(diffRecords(before, after)).toEqual({ firstName: ['Omar', 'Omer'], fee: [100, 150] })
  })
  it('never keeps passwords or tokens', () => {
    expect(sanitize({ id: 'u1', email: 'a@b.c', passwordHash: 'x', resetToken: 'y', sessionToken: 'z' })).toEqual({ id: 'u1', email: 'a@b.c' })
    expect(diffRecords({ passwordHash: 'a' }, { passwordHash: 'b' })).toEqual({})
  })
  it('long text is cut', () => {
    expect(String(sanitize({ notes: 'x'.repeat(900) })!.notes).length).toBe(501)
  })
})
