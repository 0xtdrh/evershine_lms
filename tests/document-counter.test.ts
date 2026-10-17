import { describe, expect, it, vi } from 'vitest'

// the counter row is created on the root client (its own connection), never inside the payment's transaction
const { root, state } = vi.hoisted(() => {
  const state = { counter: null as number | null, stored: 0, sql: [] as string[] }
  const root = {
    $executeRawUnsafe: vi.fn(async (sql: string) => {
      state.sql.push('ROOT-INSERT')
      if (sql.startsWith('INSERT IGNORE') && state.counter === null) state.counter = state.stored
      return 1
    }),
  }
  return { root, state }
})
vi.mock('@/lib/prisma', () => ({ prisma: root }))

import { formatNumber, takeNumber, type NumberSpec } from '@/lib/ids/counter'

const spec: NumberSpec = { prefix: 'TN-RCPT-2026-', pad: 5, table: 'FeePayment', column: 'receiptNumber' }

/** A fake transaction client over the shared state. */
function fakeTx(counter: number | null, stored: number) {
  state.counter = counter; state.stored = stored; state.sql = []
  return {
    $executeRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
      state.sql.push(sql.split(' ')[0])
      if (sql.startsWith('UPDATE')) state.counter = args[0] as number
      return 1
    }),
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT 1')) { state.sql.push('LOOK'); return state.counter === null ? [] : [{ 1: 1 }] }
      if (sql.includes('FOR UPDATE')) { state.sql.push('LOCK'); return [{ value: state.counter }] }
      state.sql.push('MAX')
      return [{ m: BigInt(state.stored) }]
    }),
  }
}

describe('locked document counter', () => {
  it('formats with the year prefix and zero padding', () => {
    expect(formatNumber('TN-RCPT-2026-', 7, 5)).toBe('TN-RCPT-2026-00007')
    expect(formatNumber('TN-INV-2026-', 123456, 5)).toBe('TN-INV-2026-123456')
  })

  it('first use: the counter row is made outside the transaction from the highest stored number', async () => {
    const tx = fakeTx(null, 41)
    expect(await takeNumber(tx as never, spec)).toBe('TN-RCPT-2026-00042')
    expect(state.sql).toEqual(['LOOK', 'ROOT-INSERT', 'LOCK', 'UPDATE'])
    expect(await takeNumber(tx as never, spec)).toBe('TN-RCPT-2026-00043')
  })

  it('normal case: only the exclusive lock inside the transaction (no INSERT, no shared lock → no deadlock)', async () => {
    const tx = fakeTx(10, 10)
    expect(await takeNumber(tx as never, spec)).toBe('TN-RCPT-2026-00011')
    expect(state.sql).toEqual(['LOOK', 'LOCK', 'UPDATE'])
  })

  it('after a clash (resync) it jumps past numbers saved outside the counter', async () => {
    const tx = fakeTx(10, 15)
    expect(await takeNumber(tx as never, spec, { resync: true })).toBe('TN-RCPT-2026-00016')
  })

  it('outside a transaction it opens its own', async () => {
    const tx = fakeTx(5, 5)
    const rootWithTx = { $transaction: vi.fn(async (fn: (t: unknown) => Promise<string>) => fn(tx)) }
    expect(await takeNumber(rootWithTx as never, spec)).toBe('TN-RCPT-2026-00006')
    expect(rootWithTx.$transaction).toHaveBeenCalledTimes(1)
  })
})
