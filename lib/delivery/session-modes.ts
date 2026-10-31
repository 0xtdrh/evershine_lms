/**
 * a02 M1 batch 2 (2026-10-31) — one session of a group taught another way that day (SessionModeOverride), and one
 * student attending one session another way (StudentSessionMode, e.g. online while travelling). Families are told when
 * a whole session changes. Server-only.
 */

import { prisma } from '@/lib/prisma'
import { notifyFamilies } from '@/lib/notifications/events'
import { levelModes } from './catalog'
import { MODE_LABEL, type Mode } from './modes'

const day = (s: string) => new Date(`${s}T00:00:00.000Z`)
const fmtEn = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const fmtAr = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

type Result = { ok: true } | { ok: false; status: number; message: string }

async function allowed(groupId: string, mode: Mode): Promise<Result | { levelId: string | null; label: string }> {
  const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { levelId: true, className: true, sectionName: true } })
  if (!g) return { ok: false, status: 404, message: 'Group not found' }
  if (g.levelId) {
    const m = (await levelModes(g.levelId)).modes
    if (!m.includes(mode)) return { ok: false, status: 409, message: `${MODE_LABEL[mode].en} is not allowed for this level · «${MODE_LABEL[mode].ar}» مش مسموحة للمستوى ده` }
  }
  return { levelId: g.levelId, label: `${g.className} ${g.sectionName}`.trim() }
}

/** Set (or with mode null remove) the way of one session of a group; the group's families are told. */
export async function setSessionMode(groupId: string, date: string, mode: Mode | null, userId: string, note?: string | null): Promise<Result> {
  if (mode === null) {
    await prisma.sessionModeOverride.deleteMany({ where: { classSectionId: groupId, date: day(date) } })
    return { ok: true }
  }
  const a = await allowed(groupId, mode)
  if ('ok' in a) return a
  await prisma.sessionModeOverride.upsert({
    where: { classSectionId_date: { classSectionId: groupId, date: day(date) } },
    create: { classSectionId: groupId, date: day(date), mode, note: note ?? null, createdById: userId },
    update: { mode, note: note ?? null, createdById: userId },
  })
  const students = (await prisma.studentEnrollment.findMany({ where: { classSectionId: groupId, status: 'ACTIVE' }, select: { studentId: true } })).map((e) => e.studentId)
  await notifyFamilies(students, 'SESSION_MODE', (s) => ({
    title: `${a.label}: session on ${fmtEn(date)} is ${MODE_LABEL[mode].en.toLowerCase()}`,
    message: `${s.firstName}'s session of ${a.label} on ${fmtEn(date)} will be ${MODE_LABEL[mode].en.toLowerCase()}.${note ? ` ${note}` : ''}`,
    titleAr: `${a.label}: حصة ${fmtAr(date)} ${MODE_LABEL[mode].ar}`,
    messageAr: `حصة ${s.firstName} في ${a.label} يوم ${fmtAr(date)} هتبقى ${MODE_LABEL[mode].ar}.${note ? ` ${note}` : ''}`,
    relatedId: groupId,
  }), { includeStudent: true })
  return { ok: true }
}

/** One student attends one session another way (null = like the group). */
export async function setStudentSessionMode(groupId: string, studentId: string, date: string, mode: Mode | null, userId: string): Promise<Result> {
  if (mode === null) {
    await prisma.studentSessionMode.deleteMany({ where: { classSectionId: groupId, studentId, date: day(date) } })
    return { ok: true }
  }
  const a = await allowed(groupId, mode)
  if ('ok' in a) return a
  const enrolled = await prisma.studentEnrollment.findFirst({ where: { classSectionId: groupId, studentId, status: 'ACTIVE' }, select: { id: true } })
  if (!enrolled) return { ok: false, status: 404, message: 'The student is not in this group · الطالب مش في الجروب ده' }
  await prisma.studentSessionMode.upsert({
    where: { classSectionId_studentId_date: { classSectionId: groupId, studentId, date: day(date) } },
    create: { classSectionId: groupId, studentId, date: day(date), mode, createdById: userId },
    update: { mode, createdById: userId },
  })
  return { ok: true }
}

/** Students of a group attending a date another way: studentId → mode (for the attendance screen). */
export async function studentModesOn(groupId: string, date: string): Promise<Map<string, Mode>> {
  const rows = await prisma.studentSessionMode.findMany({ where: { classSectionId: groupId, date: day(date) }, select: { studentId: true, mode: true } })
  return new Map(rows.map((r) => [r.studentId, r.mode as Mode]))
}

/** The way of a group's session on a date: one-off change, else the weekly slot's way (BRANCH by default). */
export async function sessionModeOn(groupId: string, date: string): Promise<Mode> {
  const o = await prisma.sessionModeOverride.findUnique({ where: { classSectionId_date: { classSectionId: groupId, date: day(date) } }, select: { mode: true } })
  if (o) return o.mode as Mode
  const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { scheduleSlots: true } })
  const wd = day(date).getUTCDay()
  const slot = (Array.isArray(g?.scheduleSlots) ? (g!.scheduleSlots as { dayOfWeek: number; mode?: Mode }[]) : []).find((s) => s.dayOfWeek === wd)
  return slot?.mode ?? 'BRANCH'
}
