/**
 * Six phases 2 (2026-11-13): watch minutes (server only).
 * recordWatch()  — the player's report: merged into the student's row; at the "watched" percent the video counts as done
 *                  (LessonProgress → lesson ticks, recorded-course progress and certificate follow by themselves).
 * Reports: per group (lessons × students), per student (families / the student), recorded-course students not watching.
 * Only the student counts: a parent or staff opening a lesson is not tracked.
 */

import { prisma } from '@/lib/prisma'
import { getSetting, setSetting } from '@/lib/settings/app-settings'
import { studentLessonAccess } from '@/lib/lms/engine'
import { visibleTo } from '@/lib/curriculum/blocks'
import { addWatch, DEFAULT_WATCH_SETTINGS, isComplete, watchedPercent, watchSettingsSchema, type Range, type WatchReport, type WatchSettings } from './watch'

const KEY = 'watch.settings'
export async function getWatchSettings(): Promise<WatchSettings> {
  return watchSettingsSchema.parse({ ...DEFAULT_WATCH_SETTINGS, ...(await getSetting<Partial<WatchSettings>>(KEY, DEFAULT_WATCH_SETTINGS)) })
}
export async function saveWatchSettings(userId: string, patch: Partial<WatchSettings>) {
  const next = watchSettingsSchema.parse({ ...(await getWatchSettings()), ...patch })
  await setSetting(KEY, next, userId)
  return next
}

export class WatchError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function videoBlock(blockId: string) {
  const b = await prisma.curriculumBlock.findUnique({ where: { id: blockId }, select: { id: true, type: true, sessionId: true, data: true } })
  if (!b || b.type !== 'VIDEO') throw new WatchError(404, 'Video not found')
  const protectedId = (b.data as { protected?: { videoId?: string } } | null)?.protected?.videoId
  const known = protectedId ? (await prisma.protectedVideo.findUnique({ where: { id: protectedId }, select: { durationSec: true } }))?.durationSec ?? null : null
  return { ...b, knownDuration: known }
}

export async function recordWatch(studentId: string, r: WatchReport) {
  const b = await videoBlock(r.blockId)
  const access = await studentLessonAccess(studentId, r.groupId, b.sessionId)
  if (!access.ok) throw new WatchError(403, access.message)
  const duration = Math.round(b.knownDuration ?? r.duration ?? 0)
  const settings = await getWatchSettings()
  const old = await prisma.videoWatch.findUnique({ where: { studentId_blockId_classSectionId: { studentId, blockId: b.id, classSectionId: r.groupId } } })
  const since = old ? Math.max(0, (Date.now() - old.lastAt.getTime()) / 1000) : 30
  const merged = addWatch({ ranges: (old?.ranges as Range[] | null) ?? [], playSec: old?.playSec ?? 0 }, r.ranges as Range[], duration || null, since)
  const done = isComplete(merged.watchedSec, duration, settings.completePercent)
  // speed: never more fast seconds than this report really played
  const fresh = merged.playSec - (old?.playSec ?? 0)
  const fastAdd = Math.round(Math.min(r.fastSec ?? 0, fresh))
  const data = {
    durationSec: duration, ranges: merged.ranges, watchedSec: merged.watchedSec, playSec: merged.playSec, lastPosition: Math.round(r.position), lastAt: new Date(),
    fastSec: (old?.fastSec ?? 0) + fastAdd, maxSpeed: Math.max(old?.maxSpeed ?? 1, fastAdd > 0 ? r.maxSpeed ?? 1 : 1),
    ...(done && !old?.completedAt ? { completedAt: new Date() } : {}),
  }
  const row = old
    ? await prisma.videoWatch.update({ where: { id: old.id }, data: { ...data, ...(r.opened ? { views: { increment: 1 } } : {}) } })
    : await prisma.videoWatch.create({ data: { studentId, blockId: b.id, classSectionId: r.groupId, sessionId: b.sessionId, ...data } })
  if (done && !old?.completedAt) {
    // watched = done in the lesson (the lesson ticks, recorded progress and the certificate follow)
    await prisma.lessonProgress.upsert({
      where: { studentId_blockId: { studentId, blockId: b.id } },
      create: { studentId, blockId: b.id, sessionId: b.sessionId, classSectionId: r.groupId },
      update: {},
    }).catch(() => null)
    const g = await prisma.classSection.findUnique({ where: { id: r.groupId }, select: { kind: true } })
    if (g?.kind === 'RECORDED') await (await import('@/lib/recorded/engine')).tryCertificate(studentId, r.groupId).catch(() => null)
  }
  // 2-B: a RECORDED session becomes "present — watched" by itself (checked at every 5 % step, not at every report)
  const step = (p: number) => Math.floor(p / 5)
  if (settings.autoAttendance && step(watchedPercent(row.watchedSec, row.durationSec)) > step(old ? watchedPercent(old.watchedSec, old.durationSec) : 0)) {
    await (await import('@/lib/attendance/recorded-watch')).autoRecordedFromWatch(studentId, r.groupId, b.sessionId)
  }
  return { watchedSec: row.watchedSec, percent: watchedPercent(row.watchedSec, row.durationSec), completed: !!row.completedAt, lastPosition: row.lastPosition }
}

export async function resumePoint(studentId: string, blockId: string, groupId: string) {
  const w = await prisma.videoWatch.findUnique({ where: { studentId_blockId_classSectionId: { studentId, blockId, classSectionId: groupId } }, select: { lastPosition: true, watchedSec: true, durationSec: true, completedAt: true } })
  return w ? { lastPosition: w.lastPosition, percent: watchedPercent(w.watchedSec, w.durationSec), completed: !!w.completedAt } : { lastPosition: 0, percent: 0, completed: false }
}

/** The video blocks of the lessons a group follows (its edition), in order. */
async function groupVideos(groupId: string) {
  const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { id: true, curriculumEditionId: true, curriculumVariantId: true, levelId: true, lessonUnlockMode: true, level: { select: { lessonUnlockMode: true } } } })
  if (!g?.levelId) return []
  const { resolveEdition } = await import('@/lib/lms/engine')
  const ed = await resolveEdition(g as never).catch(() => null)
  if (!ed) return []
  const sessions = await prisma.curriculumSession.findMany({ where: { editionId: ed.id }, orderBy: { number: 'asc' }, select: { id: true, number: true, titleEn: true, titleAr: true } })
  const blocks = await prisma.curriculumBlock.findMany({ where: { sessionId: { in: sessions.map((s) => s.id) }, type: 'VIDEO' }, orderBy: { order: 'asc' }, select: { id: true, sessionId: true, titleEn: true, titleAr: true, audience: true } })
  return blocks.filter((b) => visibleTo(b.audience, 'STUDENT')).map((b) => {
    const s = sessions.find((x) => x.id === b.sessionId)!
    return { blockId: b.id, sessionId: b.sessionId, session: s.number, sessionTitle: { en: s.titleEn || s.titleAr || '', ar: s.titleAr || s.titleEn || '' }, title: { en: b.titleEn || b.titleAr || '', ar: b.titleAr || b.titleEn || '' } }
  }).sort((a, b) => a.session - b.session)
}

/** Lessons × students of a group: percent / minutes watched / last time. */
export async function groupWatchReport(groupId: string) {
  const [videos, enr] = await Promise.all([
    groupVideos(groupId),
    prisma.studentEnrollment.findMany({ where: { classSectionId: groupId, status: 'ACTIVE' }, select: { student: { select: { id: true, firstName: true, lastName: true } } } }),
  ])
  const rows = await prisma.videoWatch.findMany({ where: { classSectionId: groupId, blockId: { in: videos.map((v) => v.blockId) } }, select: { studentId: true, blockId: true, watchedSec: true, durationSec: true, playSec: true, fastSec: true, maxSpeed: true, completedAt: true, lastAt: true } })
  return {
    videos,
    students: enr.map(({ student: s }) => {
      const mine = rows.filter((r) => r.studentId === s.id)
      return {
        id: s.id, name: `${s.firstName} ${s.lastName}`,
        minutes: Math.round(mine.reduce((n, r) => n + r.watchedSec, 0) / 60),
        completed: mine.filter((r) => r.completedAt).length,
        lastAt: mine.reduce<Date | null>((d, r) => (!d || r.lastAt > d ? r.lastAt : d), null),
        // who speeds up: share of the play time faster than 1×, and the fastest speed
        fastPercent: (() => { const play = mine.reduce((n, r) => n + r.playSec, 0); return play ? Math.round((mine.reduce((n, r) => n + r.fastSec, 0) / play) * 100) : 0 })(),
        maxSpeed: mine.reduce((m, r) => Math.max(m, r.maxSpeed), 1),
        cells: Object.fromEntries(mine.map((r) => [r.blockId, { percent: watchedPercent(r.watchedSec, r.durationSec), minutes: Math.round(r.watchedSec / 60), done: !!r.completedAt, fastPercent: r.playSec ? Math.round((r.fastSec / r.playSec) * 100) : 0, maxSpeed: r.maxSpeed }])),
      }
    }),
  }
}

/** One student (family / the student): per group, minutes this week and in all, videos watched / total, recent ones. */
export async function studentWatchSummary(studentId: string) {
  const groups = await prisma.studentEnrollment.findMany({ where: { studentId, status: 'ACTIVE', classSection: { levelId: { not: null } } }, select: { classSection: { select: { id: true, className: true, sectionName: true, level: { select: { name: true, subject: { select: { name: true } } } } } } } })
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)
  const out = []
  for (const { classSection: g } of groups) {
    const videos = await groupVideos(g.id)
    if (!videos.length) continue
    const rows = await prisma.videoWatch.findMany({ where: { studentId, classSectionId: g.id }, orderBy: { lastAt: 'desc' }, select: { blockId: true, watchedSec: true, durationSec: true, playSec: true, completedAt: true, lastAt: true } })
    const weekRows = rows.filter((r) => r.lastAt >= weekAgo)
    out.push({
      groupId: g.id, group: `${g.className} ${g.sectionName}`.trim(), course: g.level?.subject?.name ?? null, level: g.level?.name ?? null,
      totalVideos: videos.length, watchedVideos: rows.filter((r) => r.completedAt).length,
      minutes: Math.round(rows.reduce((n, r) => n + r.watchedSec, 0) / 60), weekMinutes: Math.round(weekRows.reduce((n, r) => n + r.playSec, 0) / 60),
      lastAt: rows[0]?.lastAt ?? null,
      recent: rows.slice(0, 5).map((r) => {
        const v = videos.find((x) => x.blockId === r.blockId)
        return { title: v?.title ?? { en: '', ar: '' }, session: v?.session ?? null, percent: watchedPercent(r.watchedSec, r.durationSec), done: !!r.completedAt, lastAt: r.lastAt }
      }),
    })
  }
  return out
}

/** Recorded-course students (active) with no watching for `inactiveDays` (today task, the recorded courses page). */
export async function inactiveRecordedStudents(where: Record<string, unknown> = {}) {
  const s = await getWatchSettings()
  const since = new Date(Date.now() - s.inactiveDays * 86_400_000)
  const enr = await prisma.studentEnrollment.findMany({
    where: { status: 'ACTIVE', classSection: { kind: 'RECORDED', status: 'ACTIVE', ...where }, createdAt: { lt: since } },
    select: { studentId: true, classSectionId: true, student: { select: { firstName: true, lastName: true } } },
  })
  const recent = await prisma.videoWatch.findMany({ where: { lastAt: { gte: since }, classSectionId: { in: enr.map((e) => e.classSectionId) } }, select: { studentId: true, classSectionId: true } })
  const active = new Set(recent.map((r) => `${r.studentId}|${r.classSectionId}`))
  return enr.filter((e) => !active.has(`${e.studentId}|${e.classSectionId}`)).map((e) => ({ studentId: e.studentId, groupId: e.classSectionId, name: `${e.student.firstName} ${e.student.lastName}` }))
}
