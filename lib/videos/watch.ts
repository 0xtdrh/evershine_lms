/**
 * Six phases 2 (2026-11-13): watch minutes — pure maths (tests/watch.test.ts).
 * The player sends the parts of the video it really played ([start, end] in video seconds). They are merged with what was
 * already seen, so watching again, skipping back or two devices never count twice. A report can claim at most what the
 * time since the last report allows (up to 2× speed + a little slack), so a fake report cannot fill a video at once.
 */

import { z } from 'zod'

export type Range = [number, number]

export const watchSettingsSchema = z.object({
  /** a video counts as watched from this percent */
  completePercent: z.number().int().min(10).max(100).default(90),
  /** recorded-course students with no watching for this many days show in "your work today" */
  inactiveDays: z.number().int().min(1).max(60).default(7),
  /** 2-B: a RECORDED session becomes "present — watched" by itself from watching (lib/attendance/recorded-watch.ts) */
  autoAttendance: z.boolean().default(true),
  /** percent of the session's videos (all of them together) that makes it "watched" */
  attendancePercent: z.number().int().min(10).max(100).default(80),
  /** watching more than this many days after the session no longer counts (0 = no limit) */
  attendanceDays: z.number().int().min(0).max(120).default(14),
})
export type WatchSettings = z.infer<typeof watchSettingsSchema>
export const DEFAULT_WATCH_SETTINGS: WatchSettings = watchSettingsSchema.parse({})

const r1 = (n: number) => Math.round(n * 10) / 10

/** Cleans parts (inside 0..duration, start < end, rounded) and merges overlaps / touching parts (gap ≤ 1 s). */
export function mergeRanges(ranges: Range[], duration?: number | null): Range[] {
  const max = duration && duration > 0 ? duration : Infinity
  const clean = ranges
    .filter((r) => Array.isArray(r) && r.length === 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]))
    .map(([a, b]) => [r1(Math.max(0, Math.min(a, b))), r1(Math.min(max, Math.max(a, b)))] as Range)
    .filter(([a, b]) => b - a > 0.2)
    .sort((x, y) => x[0] - y[0])
  const out: Range[] = []
  for (const r of clean) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

export const coveredSeconds = (ranges: Range[]) => Math.round(ranges.reduce((s, [a, b]) => s + (b - a), 0))

/** Keeps the newest parts up to `budget` seconds (a report cannot claim more than the time that passed allows). */
export function clipToBudget(ranges: Range[], budget: number): Range[] {
  const out: Range[] = []
  let left = Math.max(0, budget)
  for (const [a, b] of [...ranges].sort((x, y) => y[1] - x[1])) {
    if (left <= 0) break
    const len = b - a
    if (len <= left) { out.push([a, b]); left -= len } else { out.push([r1(b - left), b]); left = 0 }
  }
  return out.sort((x, y) => x[0] - y[0])
}

/** Adds a report to what was already seen. `secondsSinceLast` = wall time since the previous report of this viewer. */
export function addWatch(prev: { ranges: Range[]; playSec: number }, incoming: Range[], duration: number | null, secondsSinceLast: number) {
  const budget = secondsSinceLast * 2 + 20
  const fresh = clipToBudget(mergeRanges(incoming, duration), budget)
  const ranges = mergeRanges([...prev.ranges, ...fresh], duration)
  return { ranges, watchedSec: coveredSeconds(ranges), playSec: prev.playSec + coveredSeconds(fresh) }
}

export const watchedPercent = (watchedSec: number, durationSec: number) => (durationSec > 0 ? Math.min(100, Math.round((watchedSec / durationSec) * 100)) : 0)
export const isComplete = (watchedSec: number, durationSec: number, completePercent: number) => durationSec > 0 && watchedPercent(watchedSec, durationSec) >= completePercent

export const reportSchema = z.object({
  blockId: z.string().min(1).max(40),
  groupId: z.string().min(1).max(40),
  ranges: z.array(z.tuple([z.number(), z.number()])).max(50),
  position: z.number().min(0).max(36_000),
  duration: z.number().min(0).max(36_000).nullable().optional(),
  opened: z.boolean().optional(),
  /** video seconds played faster than 1× since the last report, and the fastest speed used */
  fastSec: z.number().min(0).max(36_000).optional(),
  maxSpeed: z.number().min(0.25).max(16).optional(),
})
export type WatchReport = z.infer<typeof reportSchema>
