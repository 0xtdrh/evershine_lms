import { afterEach, describe, expect, it, vi } from 'vitest'
import { cached, forgetCached } from '@/lib/cache/ttl'

afterEach(() => vi.useRealTimers())

describe('short cache for busy screens (load test 22/11)', () => {
  it('same key inside the time limit = one load; after it = a new load', async () => {
    vi.useFakeTimers()
    const load = vi.fn(async () => 1)
    await cached('k1', 1000, load)
    await cached('k1', 1000, load)
    expect(load).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1001)
    await cached('k1', 1000, load)
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('requests at the same moment share one load', async () => {
    const load = vi.fn(() => new Promise<number>((r) => setTimeout(() => r(5), 10)))
    const [a, b] = await Promise.all([cached('k2', 1000, load), cached('k2', 1000, load)])
    expect([a, b]).toEqual([5, 5])
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('a failed load is not kept', async () => {
    const bad = vi.fn(async () => { throw new Error('db down') })
    await expect(cached('k3', 1000, bad)).rejects.toThrow('db down')
    await Promise.resolve()
    const good = vi.fn(async () => 7)
    expect(await cached('k3', 1000, good)).toBe(7)
  })
  it('forget by key or prefix', async () => {
    const load = vi.fn(async () => 1)
    await cached('today:u1', 1000, load); await cached('today:u2', 1000, load)
    forgetCached('today:', true)
    await cached('today:u1', 1000, load)
    expect(load).toHaveBeenCalledTimes(3)
  })
})
