/**
 * Six phases 2-B (2026-11-13): RECORDED session attendance from watch minutes (server only). Rules: recorded-watch-rules.ts.
 *  - autoRecordedFromWatch(): after a watch report (lib/videos/watch-engine.ts) — finds the group's session of that lesson
 *    (curriculum number → number in this month → its date via the calendar maths) and records "present — watched".
 *  - autoRecordedForDate(): after staff save attendance — a student who attends RECORDED and already watched is not
 *    left ABSENT.
 *  - recordedWatchOn(): percent watched per RECORDED student of a date (the attendance screens show it).
 * Never throws: watching or saving attendance must not break because of it.
 */

import { prisma } from '@/lib/prisma'
import { cairoToday } from '@/lib/dates/cairo'
import { visibleTo } from '@/lib/curriculum/blocks'
import { sessionsPerCycle } from '@/lib/groups/cycle-rules'
import { occurrencesFor } from '@/lib/groups/occurrences'
import { sessionModeOn, studentModesOn } from '@/lib/delivery/session-modes'
import { getWatchSettings } from '@/lib/videos/watch-engine'
import { AUTO_REMARK, recordedAttendanceAction, sessionWatchedPercent } from './recorded-watch-rules'

const DAY = 86_400_000
const ymd = (d: Date) => d.toISOString().slice(0, 10)

async function groupContext(groupId: string) {
  const g = await prisma.classSection.findUnique({
    where: { id: groupId },
    select: {
      id: true, kind: true, levelId: true, currentCycleNumber: true, currentCycleStartDate: true, startDate: true, cycleSessions: true,
      curriculumEditionId: true, curriculumVariantId: true, lessonUnlockMode: true, campusId: true, status: true,
      level: { select: { numberOfSessions: true, numberOfMonths: true, pricingType: true, lessonUnlockMode: true } },
    },
  })
  if (!g?.level || g.kind === 'RECORDED') return null // a recorded course has no dated sessions
  const perCycle = sessionsPerCycle(g.level, g.cycleSessions)
  const offset = (Math.max(1, g.currentCycleNumber) - 1) * perCycle
  const from = g.currentCycleStartDate ?? g.startDate
  return { g, perCycle, offset, from: from ? ymd(from) : ymd(new Date(Date.now() - 120 * DAY)) }
}

/** Seconds watched / length of every student-visible video of a curriculum session, for some students. */
async function sessionPercents(groupId: string, curriculumSessionId: string, studentIds: string[]): Promise<Map<string, number> | null> {
  const blocks = (await prisma.curriculumBlock.findMany({ where: { sessionId: curriculumSessionId, type: 'VIDEO' }, select: { id: true, audience: true, data: true } }))
    .filter((b) => visibleTo(b.audience, 'STUDENT'))
  if (!blocks.length) return null
  const protectedIds = blocks.map((b) => (b.data as { protected?: { videoId?: string } } | null)?.protected?.videoId).filter((x): x is string => !!x)
  const known = new Map((await prisma.protectedVideo.findMany({ where: { id: { in: protectedIds } }, select: { id: true, durationSec: true } })).map((v) => [v.id, v.durationSec ?? 0]))
  const rows = await prisma.videoWatch.findMany({ where: { classSectionId: groupId, studentId: { in: studentIds }, blockId: { in: blocks.map((b) => b.id) } }, select: { studentId: true, blockId: true, watchedSec: true, durationSec: true } })
  const out = new Map<string, number>()
  for (const sid of studentIds) {
    let unknown = false
    const videos = blocks.map((b) => {
      const r = rows.find((x) => x.studentId === sid && x.blockId === b.id)
      if (r && r.durationSec > 0) return { watchedSec: r.watchedSec, durationSec: r.durationSec }
      const len = known.get((b.data as { protected?: { videoId?: string } } | null)?.protected?.videoId ?? '') ?? 0
      if (!len) unknown = true // a video never opened and of unknown length: the session cannot be called watched yet
      return { watchedSec: 0, durationSec: len }
    })
    out.set(sid, unknown ? 0 : sessionWatchedPercent(videos))
  }
  return out
}

/** The curriculum session a group reaches at number n of its current month. */
async function curriculumSessionAt(ctx: NonNullable<Awaited<ReturnType<typeof groupContext>>>, n: number) {
  const { resolveEdition } = await import('@/lib/lms/engine')
  const ed = await resolveEdition(ctx.g as never).catch(() => null)
  if (!ed) return null
  return prisma.curriculumSession.findFirst({ where: { editionId: ed.id, number: ctx.offset + n }, select: { id: true } })
}

async function apply(groupId: string, teacherId: string | null, date: string, studentId: string, percent: number, settings: Awaited<ReturnType<typeof getWatchSettings>>) {
  const enr = await prisma.studentEnrollment.findFirst({ where: { classSectionId: groupId, studentId, status: 'ACTIVE' }, select: { id: true } })
  if (!enr) return null
  const mode = (await studentModesOn(groupId, date)).get(studentId) ?? (await sessionModeOn(groupId, date))
  const key = { studentEnrollmentId_attendanceDate: { studentEnrollmentId: enr.id, attendanceDate: new Date(`${date}T00:00:00.000Z`) } }
  const existing = await prisma.enrollmentAttendanceRecord.findUnique({ where: key, select: { status: true, presenceDetail: true } })
  const action = recordedAttendanceAction({ mode, percent, threshold: settings.attendancePercent, sessionDate: date, today: cairoToday(), maxDays: settings.attendanceDays, existing })
  if (!action) return null
  if (action === 'CREATE') {
    const markedBy = teacherId ?? (await prisma.teacher.findFirst({ where: { isActive: true }, select: { id: true } }))?.id
    if (!markedBy) return null
    await prisma.enrollmentAttendanceRecord.create({
      data: { studentEnrollmentId: enr.id, attendanceDate: key.studentEnrollmentId_attendanceDate.attendanceDate, status: 'PRESENT', markedByTeacherId: markedBy, remarks: AUTO_REMARK, mode: 'RECORDED', presenceDetail: 'WATCHED' },
    }).catch(() => null) // saved at the same moment by staff: theirs stays
    await (await import('@/lib/groups/sync-progress')).syncGroupProgress(groupId, 'system').catch(() => null)
  } else if (action === 'UPGRADE') {
    await prisma.enrollmentAttendanceRecord.update({ where: key, data: { status: 'PRESENT', remarks: AUTO_REMARK, mode: 'RECORDED', presenceDetail: 'WATCHED' } })
  } else {
    await prisma.enrollmentAttendanceRecord.update({ where: key, data: { mode: 'RECORDED', presenceDetail: 'WATCHED' } })
  }
  return action
}

/** After a watch report of a video in curriculum session `curriculumSessionId`. */
export async function autoRecordedFromWatch(studentId: string, groupId: string, curriculumSessionId: string) {
  try {
    const settings = await getWatchSettings()
    if (!settings.autoAttendance) return null
    const ctx = await groupContext(groupId)
    if (!ctx) return null
    const cs = await prisma.curriculumSession.findUnique({ where: { id: curriculumSessionId }, select: { number: true } })
    const n = (cs?.number ?? 0) - ctx.offset
    if (n < 1 || n > ctx.perCycle) return null // a lesson of another month of the level
    const today = cairoToday()
    const occ = (await occurrencesFor({ groupIds: [groupId] }, ctx.from < today ? ctx.from : today, today))[0]
    const o = occ?.occurrences.find((x) => x.sessionNumber === n && (x.status === 'HELD' || x.status === 'MISSING' || x.status === 'SCHEDULED'))
    if (!o) return null
    const percent = (await sessionPercents(groupId, curriculumSessionId, [studentId]))?.get(studentId) ?? 0
    return await apply(groupId, occ!.teacherId, o.date, studentId, percent, settings)
  } catch (err) {
    console.error('[RECORDED_WATCH_ATTENDANCE]', err)
    return null
  }
}

/** Percent watched by each student attending a date RECORDED (null = not a lesson with videos / not this month). */
export async function recordedWatchOn(groupId: string, date: string, studentIds: string[]): Promise<Map<string, number>> {
  try {
    if (!studentIds.length) return new Map()
    const ctx = await groupContext(groupId)
    if (!ctx) return new Map()
    const occ = (await occurrencesFor({ groupIds: [groupId] }, date, date))[0]
    const n = occ?.occurrences.find((x) => x.date === date && x.sessionNumber)?.sessionNumber
    if (!n) return new Map()
    const cs = await curriculumSessionAt(ctx, n)
    if (!cs) return new Map()
    return (await sessionPercents(groupId, cs.id, studentIds)) ?? new Map()
  } catch (err) {
    console.error('[RECORDED_WATCH_ON]', err)
    return new Map()
  }
}

/** After staff save attendance of a date: students attending it RECORDED who already watched become "present — watched". */
export async function autoRecordedForDate(groupId: string, date: string) {
  try {
    const settings = await getWatchSettings()
    if (!settings.autoAttendance) return 0
    const sessionMode = await sessionModeOn(groupId, date)
    const own = await studentModesOn(groupId, date)
    const enr = await prisma.studentEnrollment.findMany({ where: { classSectionId: groupId, status: 'ACTIVE' }, select: { studentId: true } })
    const recorded = enr.map((e) => e.studentId).filter((s) => (own.get(s) ?? sessionMode) === 'RECORDED')
    if (!recorded.length) return 0
    const percents = await recordedWatchOn(groupId, date, recorded)
    const occ = (await occurrencesFor({ groupIds: [groupId] }, date, date))[0]
    let changed = 0
    for (const s of recorded) if (await apply(groupId, occ?.teacherId ?? null, date, s, percents.get(s) ?? 0, settings)) changed++
    return changed
  } catch (err) {
    console.error('[RECORDED_WATCH_DATE]', err)
    return 0
  }
}
