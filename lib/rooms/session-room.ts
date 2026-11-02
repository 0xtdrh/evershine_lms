/**
 * a02 M1 follow-up (2026-11-02): one session of a group in another room, on that date only. It must be a room of the group's place, big
 * enough, and free that day: no other group's weekly session or one-day room there at an overlapping time. Server-only.
 */

import { prisma } from '@/lib/prisma'
import { cleanSlots } from '@/lib/groups/schedule-calendar'
import { getRoomsSettings } from './engine'
import { overlapsBy } from './rules'

const date = (d: string) => new Date(`${d}T00:00:00.000Z`)

/** The problem, or null when saved. */
export async function setSessionRoom(groupId: string, day: string, roomId: string | null, userId: string): Promise<string | null> {
  const where = { classSectionId_date: { classSectionId: groupId, date: date(day) } }
  if (!roomId) {
    await prisma.sessionRoomOverride.deleteMany({ where: where.classSectionId_date })
    return null
  }
  const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { campusId: true, scheduleSlots: true, sessionMinutes: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } } })
  if (!g) return 'Group not found'
  const room = await prisma.room.findFirst({ where: { id: roomId, campusId: g.campusId, isActive: true }, select: { name: true, capacity: true } })
  if (!room) return 'This room is not of this place or is stopped · القاعة دي مش تبع المكان ده أو موقوفة'
  if (g._count.enrollments > room.capacity) return `${room.name} takes ${room.capacity} students; the group has ${g._count.enrollments} · ${room.name} تاخد ${room.capacity} طلاب والجروب ${g._count.enrollments}`
  const wd = date(day).getUTCDay()
  const extra = await prisma.extraSession.findUnique({ where: { classSectionId_date: { classSectionId: groupId, date: date(day) } }, select: { time: true } })
  const time = extra?.time ?? cleanSlots(g.scheduleSlots).find((s) => s.dayOfWeek === wd)?.time
  if (!time) return 'This group has no session that day · الجروب مالوش حصة في اليوم ده'
  const { sessionMinutes } = await getRoomsSettings()
  const mine = g.sessionMinutes || sessionMinutes
  const others = await prisma.classSection.findMany({ where: { campusId: g.campusId, isActive: true, status: 'ACTIVE', id: { not: groupId } }, select: { id: true, className: true, sectionName: true, scheduleSlots: true, sessionMinutes: true } })
  const moved = await prisma.sessionRoomOverride.findMany({ where: { date: date(day), classSectionId: { in: others.map((o) => o.id) } }, select: { classSectionId: true, roomId: true } })
  const roomOf = new Map(moved.map((m) => [m.classSectionId, m.roomId]))
  for (const o of others) {
    for (const s of cleanSlots(o.scheduleSlots).filter((x) => x.dayOfWeek === wd && (!x.mode || x.mode === 'BRANCH'))) {
      const inRoom = roomOf.get(o.id) ?? s.roomId
      if (inRoom === roomId && overlapsBy(time, mine, s.time, o.sessionMinutes || sessionMinutes)) return `${room.name} is taken by ${`${o.className} ${o.sectionName}`.trim()} at ${s.time} · ${room.name} محجوزة لـ ${`${o.className} ${o.sectionName}`.trim()} الساعة ${s.time}`
    }
  }
  await prisma.sessionRoomOverride.upsert({ where, create: { ...where.classSectionId_date, roomId, createdById: userId }, update: { roomId, createdById: userId } })
  return null
}
