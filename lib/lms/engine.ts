/**
 * LMS L2 — delivering the curriculum to groups (docs/plan-learning-platform.md §2 L2). Server-only.
 *
 * - Which curriculum version a group reads: the one pinned to it; a started group with none pinned gets the newest
 *   published version pinned (so a later version never changes a running group). advance-cycle copies the pin.
 * - Which sessions are open: lib/lms/unlock.ts (mode = group > level > company default; instructor OPEN/LOCK wins).
 * - Who manages a group's lessons: Super Admin / Admin, branch manager of that branch, the group's instructor and a
 *   confirmed substitute. Secretaries do not (owner 2026-10-09: their attendance screen stays attendance only).
 * - Students see open sessions of their groups (student view: no instructor notes / instructor-only blocks); every
 *   opening and every file is logged (LessonView). Parents see what was learned (titles + objectives), read-only.
 */

import type { Prisma, Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { getTeacherByUserId, teacherCanAccessClassSection } from '@/lib/academic/teacher-scope'
import { sessionsPerCycle } from '@/lib/groups/cycle-rules'
import { occurrencesFor } from '@/lib/groups/occurrences'
import { cairoDateTimeToUtc, cairoToday } from '@/lib/dates/cairo'
import { visibleTo } from '@/lib/curriculum/blocks'
import { effectiveMode, sessionStates, sessionDone, isUnlockMode, type SessionState, type UnlockMode } from './unlock'
import { getLmsSettings } from './settings'

export interface Outcome<T = undefined> { ok: boolean; code?: string; message?: string; value?: T }
const fail = (code: string, message: string) => ({ ok: false, code, message })

/** Enrollment statuses that keep access to a group's lessons (finished groups stay open for revision). */
export const LESSON_ENROLLMENT_STATUSES = ['ACTIVE', 'PROMOTED', 'RETAINED', 'GRADUATED'] as const

const DAY = 86_400_000
const day = (d: Date) => d.toISOString().slice(0, 10)

// ───────────────────────── group context ─────────────────────────

async function loadGroup(groupId: string) {
  return prisma.classSection.findUnique({
    where: { id: groupId },
    select: {
      id: true, className: true, sectionName: true, campusId: true, status: true, startDate: true, currentCycleNumber: true,
      curriculumEditionId: true, lessonUnlockMode: true, levelId: true,
      level: { select: { id: true, name: true, numberOfSessions: true, numberOfMonths: true, pricingType: true, lessonUnlockMode: true, subject: { select: { name: true } } } },
    },
  })
}
type Group = NonNullable<Awaited<ReturnType<typeof loadGroup>>>

/** The edition a group reads; pins the newest published one once the group has started. */
export async function resolveEdition(g: Group) {
  if (g.curriculumEditionId) {
    const pinned = await prisma.curriculumEdition.findUnique({ where: { id: g.curriculumEditionId } })
    if (pinned && (pinned.status === 'PUBLISHED' || pinned.status === 'ARCHIVED')) return pinned
  }
  if (!g.levelId) return null
  const latest = await prisma.curriculumEdition.findFirst({ where: { levelId: g.levelId, status: 'PUBLISHED' }, orderBy: { number: 'desc' } })
  if (latest && g.startDate) {
    await prisma.classSection.update({ where: { id: g.id }, data: { curriculumEditionId: latest.id } }).catch(() => undefined)
  }
  return latest
}

export interface GroupLessons {
  group: { id: string; label: string; status: string; cycleNumber: number; levelId: string | null; levelName: string; courseName: string }
  edition: { id: string; number: number } | null
  /** newest published version of the level when it is newer than the group's (managers can move the group) */
  newerEdition?: { id: string; number: number } | null
  mode: UnlockMode
  modeSource: 'GROUP' | 'LEVEL' | 'COMPANY'
  /** what the group gets without its own choice (level or company) */
  defaultMode: UnlockMode
  perCycle: number
  range: { from: number; to: number }
  heldCount: number
  sessions: (SessionState & { id: string; titleEn: string; titleAr: string; objectivesEn: string | null; objectivesAr: string | null; durationMin: number | null; scheduledAt: string | null; override: 'OPEN' | 'LOCKED' | null })[]
}

/** All curriculum sessions of a group with their open / locked state (per student when studentId is given). */
export async function groupLessons(groupId: string, opts: { studentId?: string } = {}): Promise<GroupLessons | null> {
  const g = await loadGroup(groupId)
  if (!g || !g.level) return null
  const settings = await getLmsSettings()
  const mode = effectiveMode(g.lessonUnlockMode, g.level.lessonUnlockMode, settings.unlockMode)
  const modeSource = isUnlockMode(g.lessonUnlockMode) ? 'GROUP' : isUnlockMode(g.level.lessonUnlockMode) ? 'LEVEL' : 'COMPANY'
  const perCycle = sessionsPerCycle(g.level)
  const base = {
    group: { id: g.id, label: `${g.className} ${g.sectionName}`.trim(), status: g.status, cycleNumber: g.currentCycleNumber, levelId: g.levelId, levelName: g.level.name, courseName: g.level.subject?.name ?? '' },
    mode, modeSource, perCycle, defaultMode: effectiveMode(null, g.level.lessonUnlockMode, settings.unlockMode),
  } as const
  const edition = await resolveEdition(g)
  if (!edition) return { ...base, edition: null, range: { from: 1, to: 0 }, heldCount: 0, sessions: [] }

  const sessions = await prisma.curriculumSession.findMany({
    where: { editionId: edition.id }, orderBy: { number: 'asc' },
    select: { id: true, number: true, titleEn: true, titleAr: true, objectivesEn: true, objectivesAr: true, durationMin: true },
  })
  const today = cairoToday()
  const from = day(new Date(Date.now() - 200 * DAY))
  const to = day(new Date(Date.now() + 120 * DAY))
  const occ = (await occurrencesFor({ groupIds: [g.id] }, from < today ? from : today, to))[0]?.occurrences ?? []
  const heldCount = occ.filter((o) => o.status === 'HELD').reduce((m, o) => Math.max(m, o.sessionNumber ?? 0), 0)
  const startsByNo: Record<number, string> = {}
  for (const o of occ) {
    if (o.sessionNumber && (o.status === 'SCHEDULED' || o.status === 'HELD') && !startsByNo[o.sessionNumber]) {
      startsByNo[o.sessionNumber] = cairoDateTimeToUtc(o.date, o.time || '00:00').toISOString()
    }
  }
  const overrideRows = await prisma.lessonUnlock.findMany({ where: { classSectionId: g.id }, select: { sessionNumber: true, state: true } })
  const overrides: Record<number, 'OPEN' | 'LOCKED'> = {}
  for (const r of overrideRows) if (r.state === 'OPEN' || r.state === 'LOCKED') overrides[r.sessionNumber] = r.state

  let completed: Set<number> | undefined
  if (opts.studentId && mode === 'PREVIOUS') completed = await completedSessionNumbers(opts.studentId, edition.id)

  const states = sessionStates({
    mode, totalSessions: sessions.length, perCycle, cycleNumber: g.currentCycleNumber, heldCount,
    scheduledStarts: startsByNo, overrides, completed, now: new Date(),
  })
  const offset = (Math.max(1, g.currentCycleNumber) - 1) * perCycle
  return {
    ...base,
    edition: { id: edition.id, number: edition.number },
    newerEdition: await (async () => {
      const latest = await prisma.curriculumEdition.findFirst({ where: { levelId: g.levelId!, status: 'PUBLISHED' }, orderBy: { number: 'desc' }, select: { id: true, number: true } })
      return latest && latest.number > edition.number ? latest : null
    })(),
    range: { from: offset + 1, to: Math.min(sessions.length, offset + perCycle) },
    heldCount,
    sessions: sessions.map((s, i) => ({
      ...s, ...states[i],
      scheduledAt: s.number > offset ? startsByNo[s.number - offset] ?? null : null,
      override: overrides[s.number] ?? null,
    })),
  }
}

async function completedSessionNumbers(studentId: string, editionId: string): Promise<Set<number>> {
  const sessions = await prisma.curriculumSession.findMany({ where: { editionId }, select: { id: true, number: true } })
  const blocks = await prisma.curriculumBlock.findMany({ where: { sessionId: { in: sessions.map((s) => s.id) } }, select: { id: true, sessionId: true, audience: true } })
  const done = new Set((await prisma.lessonProgress.findMany({ where: { studentId, sessionId: { in: sessions.map((s) => s.id) } }, select: { blockId: true } })).map((p) => p.blockId))
  const out = new Set<number>()
  for (const s of sessions) {
    const visible = blocks.filter((b) => b.sessionId === s.id && visibleTo(b.audience, 'STUDENT')).map((b) => b.id)
    if (visible.length && sessionDone(visible, done)) out.add(s.number)
  }
  return out
}

// ───────────────────────── staff: manage a group's lessons ─────────────────────────

/** Super Admin / Admin, the branch manager of the group's branch, the group's instructor or a confirmed substitute. */
export async function canManageGroupLessons(user: { id: string; role: string; campusId?: string | null }, groupId: string): Promise<boolean> {
  const role = user.role as Role
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return true
  if (role === 'BRANCH_MANAGER') {
    if (!checkPermission(role, 'curriculum', 'read')) return false
    if (!user.campusId) return true
    const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { campusId: true } })
    return g?.campusId === user.campusId
  }
  if (role === 'TEACHER') {
    const t = await getTeacherByUserId(user.id)
    if (!t) return false
    if (await teacherCanAccessClassSection(t.id, groupId)) return true
    const sub = await prisma.substituteAssignment.count({ where: { classSectionId: groupId, substituteTeacherId: t.id, status: 'CONFIRMED' } })
    return sub > 0
  }
  return false
}

export async function setLessonOverride(groupId: string, sessionNumber: number, action: 'open' | 'lock' | 'auto', userId: string): Promise<Outcome> {
  const g = await loadGroup(groupId)
  if (!g) return fail('NOT_FOUND', 'Group not found')
  if (action === 'auto') await prisma.lessonUnlock.deleteMany({ where: { classSectionId: groupId, sessionNumber } })
  else {
    const state = action === 'open' ? 'OPEN' : 'LOCKED'
    await prisma.lessonUnlock.upsert({
      where: { classSectionId_sessionNumber: { classSectionId: groupId, sessionNumber } },
      create: { classSectionId: groupId, sessionNumber, state, byUserId: userId },
      update: { state, byUserId: userId },
    })
  }
  return { ok: true }
}

/**
 * Moves a running group to the newest published version of its level (owner 2026-10-09). Instructor open / lock and
 * group notes are by session number, so they stay. Students' ticks are carried to the matching items of the new
 * version (same session, same position and type); items that no longer exist simply have no tick.
 */
export async function moveGroupToLatest(groupId: string): Promise<Outcome<{ number: number; ticksMoved: number }>> {
  const g = await loadGroup(groupId)
  if (!g?.levelId) return fail('NOT_FOUND', 'Group not found')
  const latest = await prisma.curriculumEdition.findFirst({ where: { levelId: g.levelId, status: 'PUBLISHED' }, orderBy: { number: 'desc' } })
  if (!latest) return fail('NONE', 'This level has no published curriculum')
  if (latest.id === g.curriculumEditionId) return fail('SAME', 'The group already uses the newest version')
  let ticksMoved = 0
  await prisma.$transaction(async (tx) => {
    if (g.curriculumEditionId) {
      const key = (b: { number: number; order: number; type: string }) => `${b.number}|${b.order}|${b.type}`
      const blocksOf = async (editionId: string) => {
        const sessions = await tx.curriculumSession.findMany({ where: { editionId }, select: { id: true, number: true } })
        const blocks = await tx.curriculumBlock.findMany({ where: { sessionId: { in: sessions.map((x) => x.id) } }, select: { id: true, sessionId: true, order: true, type: true } })
        return blocks.map((b) => ({ ...b, number: sessions.find((x) => x.id === b.sessionId)!.number }))
      }
      const [oldBlocks, newBlocks] = await Promise.all([blocksOf(g.curriculumEditionId), blocksOf(latest.id)])
      const newByKey = new Map(newBlocks.map((b) => [key(b), b]))
      const oldById = new Map(oldBlocks.map((b) => [b.id, b]))
      const ticks = await tx.lessonProgress.findMany({ where: { classSectionId: groupId, blockId: { in: oldBlocks.map((b) => b.id) } } })
      for (const t of ticks) {
        const nb = newByKey.get(key(oldById.get(t.blockId)!))
        if (!nb) continue
        const exists = await tx.lessonProgress.findUnique({ where: { studentId_blockId: { studentId: t.studentId, blockId: nb.id } } })
        if (!exists) { await tx.lessonProgress.create({ data: { studentId: t.studentId, blockId: nb.id, sessionId: nb.sessionId, classSectionId: groupId, completedAt: t.completedAt } }); ticksMoved++ }
      }
    }
    await tx.classSection.update({ where: { id: groupId }, data: { curriculumEditionId: latest.id } })
  })
  return { ok: true, value: { number: latest.number, ticksMoved } }
}

export async function setGroupMode(groupId: string, mode: string | null): Promise<Outcome> {
  if (mode !== null && !isUnlockMode(mode)) return fail('INVALID', 'Unknown way of opening lessons')
  await prisma.classSection.update({ where: { id: groupId }, data: { lessonUnlockMode: mode } })
  return { ok: true }
}

/** The instructor's view of one session for a group (everything, incl. instructor notes) + group notes. */
export async function groupNotes(groupId: string, sessionNumber?: number) {
  return prisma.groupLessonNote.findMany({
    where: { classSectionId: groupId, ...(sessionNumber ? { sessionNumber } : {}) },
    orderBy: { createdAt: 'asc' },
    select: { id: true, sessionNumber: true, body: true, url: true, createdAt: true },
  })
}

// ───────────────────────── students & parents ─────────────────────────

/** The student's groups that have lessons: one per level (the newest month), active or finished. */
export async function studentLessonGroups(studentId: string) {
  const enr = await prisma.studentEnrollment.findMany({
    where: { studentId, status: { in: [...LESSON_ENROLLMENT_STATUSES] }, classSection: { levelId: { not: null } } },
    select: { classSectionId: true, classSection: { select: { id: true, levelId: true, currentCycleNumber: true, status: true, createdAt: true } } },
  })
  const byLevel = new Map<string, (typeof enr)[number]['classSection']>()
  for (const e of enr) {
    const g = e.classSection
    const cur = byLevel.get(g.levelId!)
    if (!cur || g.currentCycleNumber > cur.currentCycleNumber || (g.currentCycleNumber === cur.currentCycleNumber && g.createdAt > cur.createdAt)) byLevel.set(g.levelId!, g)
  }
  return [...byLevel.values()].sort((a, b) => (a.status === b.status ? 0 : a.status === 'ACTIVE' ? -1 : 1)).map((g) => g.id)
}

export async function studentInGroup(studentId: string, groupId: string) {
  const n = await prisma.studentEnrollment.count({ where: { studentId, classSectionId: groupId, status: { in: [...LESSON_ENROLLMENT_STATUSES] } } })
  return n > 0
}

/** "My lessons" overview for a student: groups with sessions, open state and progress. */
export async function studentLessonsOverview(studentId: string) {
  const groupIds = await studentLessonGroups(studentId)
  const out = []
  for (const id of groupIds) {
    const gl = await groupLessons(id, { studentId })
    if (!gl?.edition) continue
    const sessionIds = gl.sessions.map((s) => s.id)
    const blocks = await prisma.curriculumBlock.findMany({ where: { sessionId: { in: sessionIds } }, select: { id: true, sessionId: true, audience: true } })
    const done = new Set((await prisma.lessonProgress.findMany({ where: { studentId, sessionId: { in: sessionIds } }, select: { blockId: true } })).map((p) => p.blockId))
    out.push({
      ...gl,
      sessions: gl.sessions.map((s) => {
        const visible = blocks.filter((b) => b.sessionId === s.id && visibleTo(b.audience, 'STUDENT')).map((b) => b.id)
        const doneCount = visible.filter((b) => done.has(b)).length
        return { ...s, items: visible.length, done: doneCount }
      }),
    })
  }
  return out
}

export interface LessonAccess { ok: boolean; code?: string; message?: string; group?: GroupLessons; state?: GroupLessons['sessions'][number] }

/** Checks that a student may open one curriculum session through one of their groups. */
export async function studentLessonAccess(studentId: string, groupId: string, sessionId: string): Promise<LessonAccess> {
  if (!(await studentInGroup(studentId, groupId))) return { ok: false, code: 'FORBIDDEN', message: 'Not your group' }
  const gl = await groupLessons(groupId, { studentId })
  const state = gl?.sessions.find((s) => s.id === sessionId)
  if (!gl || !state) return { ok: false, code: 'NOT_FOUND', message: 'Lesson not found' }
  if (!state.open) return { ok: false, code: 'LOCKED', message: 'This lesson is not open yet' }
  return { ok: true, group: gl, state }
}

/** Student view of an open lesson: student-visible blocks (media through the logged proxy), ticks, group notes. */
export async function studentLesson(studentId: string, groupId: string, sessionId: string) {
  const access = await studentLessonAccess(studentId, groupId, sessionId)
  if (!access.ok) return access
  const s = await prisma.curriculumSession.findUnique({ where: { id: sessionId } })
  const blocks = (await prisma.curriculumBlock.findMany({ where: { sessionId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }))
    .filter((b) => visibleTo(b.audience, 'STUDENT'))
    .map((b) => {
      const data = (b.data ?? {}) as Record<string, unknown>
      const hasMedia = !!(data.media as { publicId?: string } | undefined)?.publicId
      return {
        id: b.id, type: b.type, audience: b.audience, titleEn: b.titleEn, titleAr: b.titleAr,
        data: hasMedia ? { ...data, media: undefined, mediaUrl: `/api/lessons/media/${b.id}?g=${groupId}&s=${studentId}`, mediaFormat: (data.media as { format?: string }).format } : data,
      }
    })
  const done = (await prisma.lessonProgress.findMany({ where: { studentId, sessionId }, select: { blockId: true } })).map((p) => p.blockId)
  const open = access.group!.sessions.filter((x) => x.open)
  const i = open.findIndex((x) => x.id === sessionId)
  return {
    ok: true,
    value: {
      group: access.group!.group,
      session: { id: s!.id, number: s!.number, titleEn: s!.titleEn, titleAr: s!.titleAr, objectivesEn: s!.objectivesEn, objectivesAr: s!.objectivesAr, materialsEn: s!.materialsEn, materialsAr: s!.materialsAr, durationMin: s!.durationMin },
      blocks, done,
      notes: await groupNotes(groupId, s!.number),
      prevId: open[i - 1]?.id ?? null,
      nextId: open[i + 1]?.id ?? null,
    },
  }
}

export async function setProgress(studentId: string, groupId: string, blockId: string, done: boolean): Promise<Outcome> {
  const b = await prisma.curriculumBlock.findUnique({ where: { id: blockId }, select: { id: true, sessionId: true, audience: true } })
  if (!b || !visibleTo(b.audience, 'STUDENT')) return fail('NOT_FOUND', 'Content not found')
  const access = await studentLessonAccess(studentId, groupId, b.sessionId)
  if (!access.ok) return fail(access.code!, access.message!)
  if (done) {
    await prisma.lessonProgress.upsert({
      where: { studentId_blockId: { studentId, blockId } },
      create: { studentId, blockId, sessionId: b.sessionId, classSectionId: groupId },
      update: {},
    })
  } else await prisma.lessonProgress.deleteMany({ where: { studentId, blockId } })
  return { ok: true }
}

export async function logLessonView(row: { userId: string; studentId?: string | null; classSectionId?: string | null; sessionId: string; blockId?: string | null; kind: 'SESSION' | 'MEDIA'; ip?: string | null; userAgent?: string | null }) {
  try {
    await prisma.lessonView.create({ data: { ...row, ip: row.ip?.slice(0, 64) ?? null, userAgent: row.userAgent?.slice(0, 300) ?? null } as Prisma.LessonViewUncheckedCreateInput })
  } catch (err) {
    console.error('[LESSON_VIEW_LOG]', err)
  }
}

/** Parent view: per group, the sessions already open with what was learned (titles + objectives). */
export async function parentLessonsSummary(studentId: string) {
  const groups = await studentLessonsOverview(studentId)
  return groups.map((g) => ({
    group: g.group, edition: g.edition,
    sessions: g.sessions.filter((s) => s.open).map((s) => ({ number: s.number, titleEn: s.titleEn, titleAr: s.titleAr, objectivesEn: s.objectivesEn, objectivesAr: s.objectivesAr, items: s.items, done: s.done })),
    total: g.sessions.length,
  }))
}
