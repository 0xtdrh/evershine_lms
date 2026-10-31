/**
 * a02 M1 batch 3 (2026-10-31) — rooms of branches and partner places (server). Pure rules: lib/rooms/rules.ts.
 * Rooms are the old `Room` table (+ kind); a place says how it keeps rooms (Campus.roomMode); DAILY places keep a count
 * per weekday (RoomDayCount). Groups' BRANCH slots carry their roomId; checkGroupSlots refuses clashes / too-small rooms.
 */

import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { cleanSlots, type Slot } from '@/lib/groups/schedule-calendar'
import { cleanRoomsSettings, dailyOverflow, DEFAULT_ROOMS_SETTINGS, roomClash, roomUsage, type Booking, type RoomMode, type RoomsSettings } from './rules'

const KEY = 'rooms.settings'
export const getRoomsSettings = () => getSetting<RoomsSettings>(KEY, DEFAULT_ROOMS_SETTINGS)
export async function saveRoomsSettings(v: Partial<RoomsSettings>, userId: string) {
  const next = cleanRoomsSettings({ ...(await getRoomsSettings()), ...v })
  await setSetting(KEY, next, userId)
  return next
}

const isBranch = (s: Slot) => !s.mode || s.mode === 'BRANCH'

/** Weekly BRANCH sessions of the running groups of a place. */
export async function bookingsAt(campusId: string, exceptGroupId?: string): Promise<Booking[]> {
  const groups = await prisma.classSection.findMany({
    where: { campusId, isActive: true, status: 'ACTIVE', ...(exceptGroupId && { id: { not: exceptGroupId } }) },
    select: { id: true, className: true, sectionName: true, scheduleSlots: true },
  })
  return groups.flatMap((g) => cleanSlots(g.scheduleSlots).filter(isBranch).map((s) => ({
    groupId: g.id, label: `${g.className} ${g.sectionName}`.trim(), dayOfWeek: s.dayOfWeek, time: s.time, roomId: s.roomId ?? null,
  })))
}

export async function placeRooms(campusId: string) {
  const [campus, rooms, counts, settings] = await Promise.all([
    prisma.campus.findUnique({ where: { id: campusId }, select: { id: true, name: true, roomMode: true, kind: true } }),
    prisma.room.findMany({ where: { campusId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }], select: { id: true, name: true, capacity: true, kind: true, isActive: true } }),
    prisma.roomDayCount.findMany({ where: { campusId }, select: { dayOfWeek: true, count: true } }),
    getRoomsSettings(),
  ])
  if (!campus) return null
  const bookings = await bookingsAt(campusId)
  return {
    campus, settings,
    rooms,
    dayCounts: Array.from({ length: 7 }, (_, d) => counts.find((c) => c.dayOfWeek === d)?.count ?? 0),
    usage: roomUsage(rooms, bookings, settings.sessionMinutes),
    unplaced: bookings.filter((b) => !b.roomId).length,
  }
}

export async function setRoomMode(campusId: string, mode: RoomMode, dayCounts?: number[]) {
  await prisma.$transaction(async (tx) => {
    await tx.campus.update({ where: { id: campusId }, data: { roomMode: mode } })
    if (dayCounts) {
      for (let d = 0; d < 7; d++) {
        const count = Math.max(0, Math.min(200, Math.round(dayCounts[d] ?? 0)))
        await tx.roomDayCount.upsert({ where: { campusId_dayOfWeek: { campusId, dayOfWeek: d } }, create: { campusId, dayOfWeek: d, count }, update: { count } })
      }
    }
  })
}

const msg = (en: string, ar: string) => `${en} · ${ar}`

/**
 * Checks a group's weekly slots against its place's rooms. Returns a message to refuse with, or null.
 * FIXED: every BRANCH slot needs a room of this place that is free and big enough. DAILY: never more sessions at once
 * than rooms that day. NONE: nothing to check.
 */
export async function checkGroupSlots(g: { id: string; campusId: string; maxStudents: number | null }, rawSlots: unknown): Promise<string | null> {
  const campus = await prisma.campus.findUnique({ where: { id: g.campusId }, select: { roomMode: true } })
  const mode = (campus?.roomMode ?? 'NONE') as RoomMode
  if (mode === 'NONE') return null
  const slots = cleanSlots(rawSlots).filter(isBranch)
  if (!slots.length) return null
  const [others, settings] = await Promise.all([bookingsAt(g.campusId, g.id), getRoomsSettings()])
  const dayName = (d: number) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]
  const dayAr = (d: number) => ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'][d]

  if (mode === 'DAILY') {
    const counts = new Map((await prisma.roomDayCount.findMany({ where: { campusId: g.campusId } })).map((c) => [c.dayOfWeek, c.count]))
    for (const s of slots) {
      const over = dailyOverflow({ groupId: g.id, label: '', dayOfWeek: s.dayOfWeek, time: s.time }, others, counts, settings.sessionMinutes)
      if (over) return msg(`${dayName(s.dayOfWeek)} ${s.time}: the place has ${over.have} room(s) that day and ${over.used} sessions would be at once`, `${dayAr(s.dayOfWeek)} ${s.time}: المكان ليه ${over.have} قاعة اليوم ده و${over.used} حصص هتبقى في نفس الوقت`)
    }
    return null
  }

  const rooms = await prisma.room.findMany({ where: { campusId: g.campusId, isActive: true }, select: { id: true, name: true, capacity: true } })
  const size = g.maxStudents ?? (await prisma.studentEnrollment.count({ where: { classSectionId: g.id, status: 'ACTIVE' } }))
  for (const s of slots) {
    if (!s.roomId) return msg(`${dayName(s.dayOfWeek)} ${s.time}: choose a room (this place keeps its rooms)`, `${dayAr(s.dayOfWeek)} ${s.time}: اختار قاعة (المكان ده مسجّل قاعاته)`)
    const room = rooms.find((r) => r.id === s.roomId)
    if (!room) return msg('This room is not of this place or is stopped', 'القاعة دي مش تبع المكان ده أو موقوفة')
    if (size > room.capacity) return msg(`${room.name} takes ${room.capacity} students; the group has ${size}`, `${room.name} تاخد ${room.capacity} طالب؛ والجروب ${size}`)
    const clash = roomClash({ groupId: g.id, label: '', dayOfWeek: s.dayOfWeek, time: s.time, roomId: s.roomId }, others, settings.sessionMinutes)
    if (clash) return msg(`${room.name} is taken by ${clash.label} on ${dayName(clash.dayOfWeek)} at ${clash.time}`, `${room.name} محجوزة لـ ${clash.label} يوم ${dayAr(clash.dayOfWeek)} الساعة ${clash.time}`)
  }
  return null
}

/** Capacities of the rooms a group uses (for its seat limit). */
export async function groupRoomCapacities(rawSlots: unknown): Promise<number[]> {
  const ids = [...new Set(cleanSlots(rawSlots).filter(isBranch).map((s) => s.roomId).filter((x): x is string => !!x))]
  if (!ids.length) return []
  return (await prisma.room.findMany({ where: { id: { in: ids } }, select: { capacity: true } })).map((r) => r.capacity)
}
