/**
 * a02 M1 batch 4 (2026-10-31) — instructors' working hours and whether they are free. Pure (tests/work-hours.test.ts).
 * Owner rules: an instructor with no hours entered is always available; sessions outside his hours, clashing with his
 * other sessions, or in two different branches on the same day are refused (a Super Admin may force).
 * Recorded sessions take no instructor time. A session lasts `minutes` (rooms.settings.sessionMinutes).
 */

import { toMin } from '@/lib/rooms/rules'
import type { Mode } from '@/lib/delivery/modes'

export interface WorkHours { dayOfWeek: number; fromTime: string; toTime: string; kind?: string; campusId: string | null; onlineOnly: boolean }
/** One weekly session the instructor teaches (or would teach). */
export interface TeachSlot { groupId: string; label: string; dayOfWeek: number; time: string; mode: Mode; campusId: string }

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
export function cleanHours(rows: WorkHours[]): WorkHours[] {
  return rows
    .filter((r) => Number.isInteger(r.dayOfWeek) && r.dayOfWeek >= 0 && r.dayOfWeek <= 6 && TIME.test(r.fromTime) && TIME.test(r.toTime) && toMin(r.toTime) > toMin(r.fromTime))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.fromTime.localeCompare(b.fromTime))
}

/** Do his hours cover this session? (no hours entered = yes) */
export function hoursCover(hours: WorkHours[], s: Pick<TeachSlot, 'dayOfWeek' | 'time' | 'mode' | 'campusId'>, minutes: number): boolean {
  if (s.mode === 'RECORDED') return true
  if (!hours.length) return true
  const start = toMin(s.time), end = start + minutes
  return hours.some((h) => h.dayOfWeek === s.dayOfWeek && toMin(h.fromTime) <= start && end <= toMin(h.toTime)
    && (h.onlineOnly ? s.mode === 'ONLINE' : !h.campusId || h.campusId === s.campusId || s.mode === 'ONLINE'))
}

/** Another session of his at an overlapping time (null = free). */
export function teachClash(s: TeachSlot, others: TeachSlot[], minutes: number): TeachSlot | null {
  if (s.mode === 'RECORDED') return null
  return others.find((o) => o.groupId !== s.groupId && o.mode !== 'RECORDED' && o.dayOfWeek === s.dayOfWeek && Math.abs(toMin(o.time) - toMin(s.time)) < minutes) ?? null
}

/** A branch session the same day in a different branch (null = fine). */
export function twoBranchesSameDay(s: TeachSlot, others: TeachSlot[]): TeachSlot | null {
  if (s.mode !== 'BRANCH') return null
  return others.find((o) => o.groupId !== s.groupId && o.mode === 'BRANCH' && o.dayOfWeek === s.dayOfWeek && o.campusId !== s.campusId) ?? null
}

/** The first problem with giving him these sessions, or null. */
export function teachProblem(hours: WorkHours[], mine: TeachSlot[], others: TeachSlot[], minutes: number):
  | { kind: 'HOURS' | 'CLASH' | 'TWO_BRANCHES'; slot: TeachSlot; other?: TeachSlot } | null {
  for (const s of mine) {
    if (!hoursCover(hours, s, minutes)) return { kind: 'HOURS', slot: s }
    const c = teachClash(s, others, minutes)
    if (c) return { kind: 'CLASH', slot: s, other: c }
    const t = twoBranchesSameDay(s, others)
    if (t) return { kind: 'TWO_BRANCHES', slot: s, other: t }
  }
  return null
}
