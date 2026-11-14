import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cycleIsFull } from '@/lib/attendance/cycle-full'
import { isLegacyApi } from '@/lib/security/legacy'

describe('cycleIsFull (F12, final test 14/11)', () => {
  const held = ['2026-11-01', '2026-11-04', '2026-11-08', '2026-11-11']
  it('refuses a 5th date in a 4-session month', () => {
    expect(cycleIsFull(held, 4, '2026-11-15')).toBe(true)
  })
  it('still lets staff correct a date already held', () => {
    expect(cycleIsFull(held, 4, '2026-11-08')).toBe(false)
  })
  it('allows dates while the month is not complete', () => {
    expect(cycleIsFull(held.slice(0, 3), 4, '2026-11-11')).toBe(false)
    expect(cycleIsFull([], 4, '2026-11-01')).toBe(false)
  })
  it('never blocks with a broken session count', () => {
    expect(cycleIsFull(held, 0, '2026-11-15')).toBe(false)
  })
})

/** J02: every attendance route checks the branch / instructor through lib/attendance/access.ts (or is a locked legacy route). */
describe('attendance routes all check who may open the group', () => {
  const root = join(process.cwd(), 'app', 'api', 'enrollment-attendance')
  const routes: string[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (f === 'route.ts') routes.push(p)
    }
  }
  walk(root)

  it('finds the routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(5)
  })

  for (const p of routes) {
    const api = '/api/' + p.split(/[\\/]app[\\/]api[\\/]/)[1].replace(/[\\/]route\.ts$/, '').replace(/\\/g, '/')
    it(`${api} uses groupAttendanceAccess, a place filter, or is locked`, () => {
      const src = readFileSync(p, 'utf8')
      const ok = src.includes('groupAttendanceAccess') || src.includes('assertCanMarkGroup') || isLegacyApi(api)
      expect(ok, `${api} has no branch / instructor check`).toBe(true)
    })
  }
})
