/**
 * a02 M1 batch 3 (2026-10-31) — rooms of branches and partner places. Pure (tests/rooms-rules.test.ts).
 * A place keeps NONE (no rooms), FIXED (named rooms with a capacity) or DAILY (only how many rooms it has each weekday).
 * Only BRANCH sessions use a room. Two weekly sessions clash when they are on the same weekday and their times overlap
 * (a session lasts `minutes`, setting rooms.settings.sessionMinutes). Owner: a room can never be booked twice and a group
 * can never be bigger than its room; only a Super Admin may force it.
 */

export const ROOM_MODES = ['NONE', 'FIXED', 'DAILY'] as const
export type RoomMode = (typeof ROOM_MODES)[number]
export interface RoomsSettings { sessionMinutes: number }
export const DEFAULT_ROOMS_SETTINGS: RoomsSettings = { sessionMinutes: 90 }

/** A weekly BRANCH session of a group, with its room (FIXED places). */
export interface Booking { groupId: string; label: string; dayOfWeek: number; time: string; roomId?: string | null }

export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
export const overlaps = (a: string, b: string, minutes: number) => Math.abs(toMin(a) - toMin(b)) < minutes

/** Another group already in this room at this time (null = free). */
export function roomClash(slot: Booking, others: Booking[], minutes: number): Booking | null {
  if (!slot.roomId) return null
  return others.find((o) => o.groupId !== slot.groupId && o.roomId === slot.roomId && o.dayOfWeek === slot.dayOfWeek && overlaps(o.time, slot.time, minutes)) ?? null
}

/** DAILY places: would this session need more rooms than the place has that day? Returns the count in use (incl. this one). */
export function dailyOverflow(slot: Booking, others: Booking[], counts: Map<number, number>, minutes: number): { used: number; have: number } | null {
  const have = counts.get(slot.dayOfWeek) ?? 0
  const used = 1 + others.filter((o) => o.groupId !== slot.groupId && o.dayOfWeek === slot.dayOfWeek && overlaps(o.time, slot.time, minutes)).length
  return used > have ? { used, have } : null
}

/** How many students a group may take: its own limit and the smallest room it uses (null = no limit). */
export function seatLimit(maxStudents: number | null, roomCapacities: number[]): number | null {
  const caps = roomCapacities.filter((c) => c > 0)
  const limits = [...(maxStudents != null ? [maxStudents] : []), ...(caps.length ? [Math.min(...caps)] : [])]
  return limits.length ? Math.min(...limits) : null
}

/** Weekly use of each room: booked minutes and the sessions in it. */
export function roomUsage(rooms: { id: string }[], bookings: Booking[], minutes: number) {
  return rooms.map((r) => {
    const mine = bookings.filter((b) => b.roomId === r.id).sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.time.localeCompare(b.time))
    return { roomId: r.id, sessions: mine, minutesPerWeek: mine.length * minutes }
  })
}

export function cleanRoomsSettings(v: Partial<RoomsSettings>): RoomsSettings {
  const n = Math.round(Number(v.sessionMinutes))
  return { sessionMinutes: Number.isFinite(n) ? Math.min(300, Math.max(15, n)) : DEFAULT_ROOMS_SETTINGS.sessionMinutes }
}
