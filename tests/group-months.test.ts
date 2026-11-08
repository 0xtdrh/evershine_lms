import { describe, expect, it } from 'vitest'
import { attendancePct, walkChain, whoContinued } from '@/lib/groups/months'

const L = (from: string, to: string, day = 1) => ({ from, to, at: new Date(2026, 0, day) })

describe('months of a group', () => {
  it('gives the whole chain, oldest first, from any month', () => {
    const links = [L('b', 'c', 2), L('a', 'b', 1)]
    for (const id of ['a', 'b', 'c']) expect(walkChain(links, id)).toEqual(['a', 'b', 'c'])
  })
  it('a group with no links is one month', () => {
    expect(walkChain([], 'x')).toEqual(['x'])
  })
  it('a group advanced twice follows the latest link', () => {
    expect(walkChain([L('a', 'old', 1), L('a', 'new', 5)], 'a')).toEqual(['a', 'new'])
  })
  it('never loops forever', () => {
    expect(walkChain([L('a', 'b', 1), L('b', 'a', 2)], 'a').sort()).toEqual(['a', 'b'])
    expect(walkChain([L('a', 'a', 1)], 'a')).toEqual(['a'])
  })
  it('attendance %: late counts, an excused absence does not', () => {
    expect(attendancePct(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'])).toBe(50)
    expect(attendancePct([])).toBeNull()
  })
  it('who went on and who stopped; moved to another group is not stopped; no next month yet = nothing to say', () => {
    const st = [{ id: '1', name: 'A', transferred: false }, { id: '2', name: 'B', transferred: false }, { id: '3', name: 'C', transferred: true }]
    expect(whoContinued(st, ['1'])).toEqual({ continued: 1, stopped: [{ id: '2', name: 'B' }] })
    expect(whoContinued(st, null)).toBeNull()
  })
})
