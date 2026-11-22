import { describe, expect, it, vi } from 'vitest'

const calls: string[] = []
const state = { lockOk: 1 }
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) => fn({
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join('?')
        calls.push(sql.includes('GET_LOCK') ? 'GET' : 'RELEASE')
        return sql.includes('GET_LOCK') ? [{ ok: state.lockOk }] : [{}]
      },
    }),
  },
}))
vi.mock('@/lib/rooms/rules', () => ({ seatLimit: () => null }))
vi.mock('@/lib/rooms/engine', () => ({ groupRoomCapacities: async () => [] }))
vi.mock('@/lib/academic/engine', () => ({ getActiveAcademicYear: async () => null }))
vi.mock('@/lib/groups/instructor', () => ({ pickGroupInstructorOffering: () => null }))

import { withSeatLock } from '@/lib/groups/capacity'

describe('seat lock (final test X07: the last seat for two families)', () => {
  it('takes the lock, runs the job, releases the lock', async () => {
    calls.length = 0; state.lockOk = 1
    expect(await withSeatLock('g1', async () => { calls.push('JOB'); return 7 })).toBe(7)
    expect(calls).toEqual(['GET', 'JOB', 'RELEASE'])
  })
  it('releases the lock even when the job fails', async () => {
    calls.length = 0; state.lockOk = 1
    await expect(withSeatLock('g1', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(calls).toEqual(['GET', 'RELEASE'])
  })
  it('if the lock cannot be taken, the job does not run', async () => {
    calls.length = 0; state.lockOk = 0
    await expect(withSeatLock('g1', async () => { calls.push('JOB') })).rejects.toThrow(/busy/)
    expect(calls).toEqual(['GET'])
  })
})
