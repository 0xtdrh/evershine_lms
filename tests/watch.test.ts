import { describe, expect, it } from 'vitest'
import { addWatch, clipToBudget, coveredSeconds, isComplete, mergeRanges, watchedPercent, type Range } from '@/lib/videos/watch'

describe('watch minutes', () => {
  it('merges overlapping and touching parts, inside the video', () => {
    expect(mergeRanges([[10, 20], [15, 30], [30.5, 40], [50, 60]])).toEqual([[10, 40], [50, 60]])
    expect(mergeRanges([[-5, 10], [590, 700]], 600)).toEqual([[0, 10], [590, 600]])
    expect(mergeRanges([[20, 10]])).toEqual([[10, 20]])
    expect(mergeRanges([[5, 5.1]])).toEqual([])
  })
  it('watching the same part again or on another device never counts twice', () => {
    let s = { ranges: [] as Range[], playSec: 0 }
    s = { ...s, ...addWatch(s, [[0, 30]], 600, 30) }
    s = { ...s, ...addWatch(s, [[0, 30]], 600, 30) }
    expect(coveredSeconds(s.ranges)).toBe(30)
    expect(s.playSec).toBe(60)
  })
  it('a report cannot claim more than the time that passed allows (2x speed + slack)', () => {
    const r = addWatch({ ranges: [], playSec: 0 }, [[0, 600]], 600, 15)
    expect(r.watchedSec).toBe(50) // 15 s × 2 + 20
    expect(clipToBudget([[0, 10], [20, 60]], 25)).toEqual([[35, 60]])
  })
  it('percent and complete', () => {
    expect(watchedPercent(540, 600)).toBe(90)
    expect(isComplete(540, 600, 90)).toBe(true)
    expect(isComplete(530, 600, 90)).toBe(false)
    expect(isComplete(10, 0, 90)).toBe(false)
  })
})
