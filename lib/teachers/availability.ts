/**
 * a02 M1 batch 4 (2026-10-31) — instructors' working hours (server). Pure rules: lib/teachers/work-hours.ts.
 * Used when an instructor is given a group, when a group with an instructor changes its schedule, and when substitutes
 * are suggested (only qualified AND free instructors).
 */

import { prisma } from '@/lib/prisma'
import { cleanSlots } from '@/lib/groups/schedule-calendar'
import { getRoomsSettings } from '@/lib/rooms/engine'
import { cleanHours, hoursCover, teachClash, teachProblem, type TeachSlot, type WorkHours } from './work-hours'
import type { Mode } from '@/lib/delivery/modes'

export async function teacherHours(teacherId: string): Promise<WorkHours[]> {
  const rows = await prisma.teacherWorkHours.findMany({ where: { teacherId }, select: { dayOfWeek: true, fromTime: true, toTime: true, kind: true, campusId: true, onlineOnly: true } })
  return cleanHours(rows)
}

export async function saveTeacherHours(teacherId: string, rows: WorkHours[]) {
  const clean = cleanHours(rows)
  await prisma.$transaction([
    prisma.teacherWorkHours.deleteMany({ where: { teacherId } }),
    prisma.teacherWorkHours.createMany({ data: clean.map((r) => ({ teacherId, dayOfWeek: r.dayOfWeek, fromTime: r.fromTime, toTime: r.toTime, kind: r.kind === 'AVAILABLE' ? 'AVAILABLE' : 'SHIFT', campusId: r.campusId || null, onlineOnly: !!r.onlineOnly })) }),
  ])
  return clean
}

type GroupRow = { id: string; className: string; sectionName: string; campusId: string; scheduleSlots: unknown }
export const groupTeachSlots = (g: GroupRow, slots?: unknown): TeachSlot[] =>
  cleanSlots(slots ?? g.scheduleSlots).map((s) => ({ groupId: g.id, label: `${g.className} ${g.sectionName}`.trim(), dayOfWeek: s.dayOfWeek, time: s.time, mode: (s.mode ?? 'BRANCH') as Mode, campusId: g.campusId }))

/** Weekly sessions of the running groups this instructor teaches (optionally without one group). */
export async function teacherSlots(teacherId: string, exceptGroupId?: string): Promise<TeachSlot[]> {
  const offers = await prisma.subjectOffering.findMany({
    where: { teacherId, classSection: { isActive: true, status: 'ACTIVE', ...(exceptGroupId && { id: { not: exceptGroupId } }) } },
    select: { classSection: { select: { id: true, className: true, sectionName: true, campusId: true, scheduleSlots: true } } },
  })
  const seen = new Set<string>()
  return offers.flatMap((o) => (seen.has(o.classSection.id) ? [] : (seen.add(o.classSection.id), groupTeachSlots(o.classSection))))
}

const DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_AR = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت']

/** Message to refuse with when this instructor cannot take this group's sessions, else null. */
export async function checkTeacherForGroup(teacherId: string, g: GroupRow, slots?: unknown): Promise<string | null> {
  const [hours, others, settings, teacher] = await Promise.all([
    teacherHours(teacherId), teacherSlots(teacherId, g.id), getRoomsSettings(),
    prisma.teacher.findUnique({ where: { id: teacherId }, select: { firstName: true, lastName: true } }),
  ])
  const p = teachProblem(hours, groupTeachSlots(g, slots), others, settings.sessionMinutes)
  if (!p) return null
  const who = `${teacher?.firstName ?? ''} ${teacher?.lastName ?? ''}`.trim()
  const at = `${DAY_EN[p.slot.dayOfWeek]} ${p.slot.time}`, atAr = `${DAY_AR[p.slot.dayOfWeek]} ${p.slot.time}`
  if (p.kind === 'HOURS') return `${who}: ${at} is outside his working hours · ${who}: ${atAr} برا ساعات شغله`
  if (p.kind === 'CLASH') return `${who}: ${at} clashes with ${p.other!.label} · ${who}: ${atAr} متعارض مع ${p.other!.label}`
  return `${who}: ${at} — he is in another branch that day (${p.other!.label}) · ${who}: ${atAr} — عنده فرع تاني اليوم ده (${p.other!.label})`
}

/** Is this instructor free for one session? (hours + no clash) — for substitute suggestions. */
export async function teacherFreeFor(teacherId: string, s: { dayOfWeek: number; time: string; campusId: string; mode?: Mode }): Promise<boolean> {
  const [hours, others, settings] = await Promise.all([teacherHours(teacherId), teacherSlots(teacherId), getRoomsSettings()])
  const slot: TeachSlot = { groupId: '__cover__', label: '', dayOfWeek: s.dayOfWeek, time: s.time, mode: s.mode ?? 'BRANCH', campusId: s.campusId }
  return hoursCover(hours, slot, settings.sessionMinutes) && !teachClash(slot, others, settings.sessionMinutes)
}
