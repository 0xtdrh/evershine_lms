/**
 * LMS L1 — curriculum library (docs/plan-learning-platform.md §2).
 * Track > Course > Level > Edition (version) > Session > Block. An edition is DRAFT → IN_REVIEW → PUBLISHED; publishing
 * archives the previous published edition of that level (groups pinned to it keep reading it). Only DRAFT editions can
 * be edited; to change a published curriculum you make a new draft copy.
 * Who sees what: curriculum:update = authors (all editions), curriculum:approve = publish/reject/archive,
 * others with curriculum:read (instructors, branch managers) see only published / archived editions; instructors
 * only for the levels they teach or are qualified for.
 */

import type { Prisma, Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { curriculumMediaUrl } from '@/lib/cloudinary'
import { getTeacherByUserId } from '@/lib/academic/teacher-scope'
import { staffNames } from '@/lib/contacts/contact-log'
import { nextStatus, validateBlockData, visibleTo, type EditionAction } from './blocks'

export interface Viewer {
  userId: string
  role: Role
  canRead: boolean
  canEdit: boolean
  canApprove: boolean
  canDelete: boolean
  /** null = every level */
  levelIds: string[] | null
}

export interface Outcome<T = undefined> { ok: boolean; code?: string; message?: string; value?: T }
const fail = (code: string, message: string) => ({ ok: false, code, message })

/** Levels an instructor may read: groups they teach or substitute in + levels they are qualified for. */
export async function teacherLevelIds(userId: string): Promise<string[]> {
  const teacher = await getTeacherByUserId(userId)
  if (!teacher) return []
  const [offerings, subs, quals] = await Promise.all([
    prisma.subjectOffering.findMany({ where: { teacherId: teacher.id }, select: { classSection: { select: { levelId: true } } } }),
    prisma.substituteAssignment.findMany({ where: { substituteTeacherId: teacher.id }, select: { classSection: { select: { levelId: true } } } }),
    prisma.teacherQualifiedSubject.findMany({ where: { teacherId: teacher.id }, select: { trackId: true, subjectId: true, levelId: true } }),
  ])
  const ids = new Set<string>()
  for (const o of [...offerings, ...subs]) if (o.classSection?.levelId) ids.add(o.classSection.levelId)
  const subjectIds = quals.filter((q) => q.subjectId && !q.levelId).map((q) => q.subjectId!)
  const trackIds = quals.filter((q) => q.trackId && !q.subjectId && !q.levelId).map((q) => q.trackId!)
  for (const q of quals) if (q.levelId) ids.add(q.levelId)
  if (subjectIds.length || trackIds.length) {
    const levels = await prisma.level.findMany({
      where: { OR: [{ subjectId: { in: subjectIds } }, { subject: { trackId: { in: trackIds } } }] },
      select: { id: true },
    })
    for (const l of levels) ids.add(l.id)
  }
  return [...ids]
}

export async function viewerFor(user: { id: string; role: string }): Promise<Viewer> {
  const role = user.role as Role
  const v: Viewer = {
    userId: user.id, role,
    canRead: checkPermission(role, 'curriculum', 'read'),
    canEdit: checkPermission(role, 'curriculum', 'update'),
    canApprove: checkPermission(role, 'curriculum', 'approve'),
    canDelete: checkPermission(role, 'curriculum', 'delete'),
    levelIds: null,
  }
  if (role === 'TEACHER' && !v.canEdit) v.levelIds = await teacherLevelIds(user.id)
  return v
}

const levelVisible = (v: Viewer, levelId: string) => v.canRead && (v.levelIds === null || v.levelIds.includes(levelId))
const editionVisible = (v: Viewer, e: { levelId: string; status: string }) =>
  levelVisible(v, e.levelId) && (v.canEdit || e.status === 'PUBLISHED' || e.status === 'ARCHIVED')

// ───────────────────────── tree ─────────────────────────

export async function curriculumTree(v: Viewer) {
  const [tracks, courses, levels, editions] = await Promise.all([
    prisma.track.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.academicSubject.findMany({ where: { isActive: true }, orderBy: [{ trackOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, trackId: true } }),
    prisma.level.findMany({ where: { isActive: true, ...(v.levelIds ? { id: { in: v.levelIds } } : {}) }, orderBy: { order: 'asc' }, select: { id: true, name: true, order: true, subjectId: true, numberOfSessions: true } }),
    prisma.curriculumEdition.findMany({ select: { id: true, levelId: true, number: true, status: true } }),
  ])
  const levelInfo = (levelId: string) => {
    const eds = editions.filter((e) => e.levelId === levelId && editionVisible(v, e))
    const published = eds.filter((e) => e.status === 'PUBLISHED').sort((a, b) => b.number - a.number)[0]
    return {
      publishedNumber: published?.number ?? null,
      draftCount: eds.filter((e) => e.status === 'DRAFT').length,
      reviewCount: eds.filter((e) => e.status === 'IN_REVIEW').length,
    }
  }
  const courseNode = (c: (typeof courses)[number]) => ({
    id: c.id, name: c.name,
    levels: levels.filter((l) => l.subjectId === c.id).map((l) => ({ ...l, ...levelInfo(l.id) })),
  })
  const tree = tracks.map((t) => ({ id: t.id, name: t.name, courses: courses.filter((c) => c.trackId === t.id).map(courseNode).filter((c) => c.levels.length) }))
  const loose = courses.filter((c) => !c.trackId || !tracks.some((t) => t.id === c.trackId)).map(courseNode).filter((c) => c.levels.length)
  if (loose.length) tree.push({ id: 'none', name: 'Other courses', courses: loose })
  return tree.filter((t) => t.courses.length)
}

// ───────────────────────── editions ─────────────────────────

export async function levelEditions(v: Viewer, levelId: string) {
  if (!levelVisible(v, levelId)) return null
  const level = await prisma.level.findUnique({
    where: { id: levelId },
    select: { id: true, name: true, numberOfSessions: true, subject: { select: { id: true, name: true, track: { select: { name: true } } } } },
  })
  if (!level) return null
  const editions = await prisma.curriculumEdition.findMany({ where: { levelId }, orderBy: { number: 'desc' } })
  const visible = editions.filter((e) => editionVisible(v, e))
  const ids = visible.map((e) => e.id)
  const [counts, groups] = await Promise.all([
    prisma.curriculumSession.groupBy({ by: ['editionId'], where: { editionId: { in: ids } }, _count: { _all: true } }),
    prisma.classSection.groupBy({ by: ['curriculumEditionId'], where: { curriculumEditionId: { in: ids } }, _count: { _all: true } }),
  ])
  return {
    level,
    editions: visible.map((e) => ({
      ...e,
      sessionCount: counts.find((c) => c.editionId === e.id)?._count._all ?? 0,
      groupCount: groups.find((g) => g.curriculumEditionId === e.id)?._count._all ?? 0,
    })),
  }
}

export async function getEdition(v: Viewer, editionId: string) {
  const e = await prisma.curriculumEdition.findUnique({ where: { id: editionId } })
  if (!e || !editionVisible(v, e)) return null
  const sessions = await prisma.curriculumSession.findMany({
    where: { editionId }, orderBy: { number: 'asc' },
    select: { id: true, number: true, titleEn: true, titleAr: true, durationMin: true },
  })
  const blockCounts = await prisma.curriculumBlock.groupBy({ by: ['sessionId'], where: { sessionId: { in: sessions.map((s) => s.id) } }, _count: { _all: true } })
  const openComments = v.canEdit
    ? await prisma.curriculumComment.groupBy({ by: ['sessionId'], where: { sessionId: { in: sessions.map((s) => s.id) }, resolved: false }, _count: { _all: true } })
    : []
  return {
    edition: e,
    sessions: sessions.map((s) => ({
      ...s,
      blockCount: blockCounts.find((b) => b.sessionId === s.id)?._count._all ?? 0,
      openComments: openComments.find((c) => c.sessionId === s.id)?._count._all ?? 0,
    })),
  }
}

/** New edition of a level: blank (one empty session per planned session) or a copy of another edition. */
export async function createEdition(v: Viewer, levelId: string, copyFromId?: string | null, notes?: string | null): Promise<Outcome<{ id: string; number: number }>> {
  if (!v.canEdit) return fail('FORBIDDEN', 'You cannot write curriculum')
  const level = await prisma.level.findUnique({ where: { id: levelId }, select: { id: true, numberOfSessions: true } })
  if (!level) return fail('NOT_FOUND', 'Level not found')
  let source: { id: string; levelId: string } | null = null
  if (copyFromId) {
    source = await prisma.curriculumEdition.findUnique({ where: { id: copyFromId }, select: { id: true, levelId: true } })
    if (!source) return fail('NOT_FOUND', 'Version to copy not found')
  }
  const created = await prisma.$transaction(async (tx) => {
    const last = await tx.curriculumEdition.findFirst({ where: { levelId }, orderBy: { number: 'desc' }, select: { number: true } })
    const number = (last?.number ?? 0) + 1
    const ed = await tx.curriculumEdition.create({ data: { levelId, number, status: 'DRAFT', notes: notes ?? null, copiedFromId: source?.id ?? null, createdById: v.userId } })
    if (source) await copySessions(tx, source.id, ed.id)
    else {
      const n = Math.max(1, Math.min(level.numberOfSessions || 1, 200))
      await tx.curriculumSession.createMany({ data: Array.from({ length: n }, (_, i) => ({ editionId: ed.id, number: i + 1 })) })
    }
    return { id: ed.id, number }
  })
  return { ok: true, value: created }
}

async function copySessions(tx: Prisma.TransactionClient, fromEditionId: string, toEditionId: string) {
  const sessions = await tx.curriculumSession.findMany({ where: { editionId: fromEditionId }, orderBy: { number: 'asc' } })
  for (const s of sessions) {
    const { id: _id, editionId: _e, createdAt: _c, updatedAt: _u, ...rest } = s
    const ns = await tx.curriculumSession.create({ data: { ...rest, skillIds: (s.skillIds ?? undefined) as Prisma.InputJsonValue, editionId: toEditionId } })
    const blocks = await tx.curriculumBlock.findMany({ where: { sessionId: s.id }, orderBy: { order: 'asc' } })
    if (blocks.length) {
      await tx.curriculumBlock.createMany({
        data: blocks.map((b) => ({ sessionId: ns.id, order: b.order, type: b.type, audience: b.audience, titleEn: b.titleEn, titleAr: b.titleAr, data: b.data as Prisma.InputJsonValue })),
      })
    }
  }
}

export async function changeEditionStatus(v: Viewer, editionId: string, action: EditionAction): Promise<Outcome<{ status: string }>> {
  if (!v.canEdit && !v.canApprove) return fail('FORBIDDEN', 'You cannot change curriculum')
  const e = await prisma.curriculumEdition.findUnique({ where: { id: editionId } })
  if (!e) return fail('NOT_FOUND', 'Version not found')
  const to = nextStatus(e.status, action, v.canApprove)
  if (!to) return fail('BAD_STATUS', `Cannot ${action} a ${e.status.toLowerCase().replace('_', ' ')} version`)
  if (to === 'IN_REVIEW' || to === 'PUBLISHED') {
    const empty = await prisma.curriculumSession.count({ where: { editionId, titleEn: '', titleAr: '' } })
    if (empty) return fail('INCOMPLETE', `${empty} session(s) still have no title`)
  }
  await prisma.$transaction(async (tx) => {
    if (to === 'PUBLISHED') {
      await tx.curriculumEdition.updateMany({ where: { levelId: e.levelId, status: 'PUBLISHED', id: { not: e.id } }, data: { status: 'ARCHIVED' } })
    }
    await tx.curriculumEdition.update({
      where: { id: e.id },
      data: {
        status: to,
        ...(to === 'IN_REVIEW' ? { submittedAt: new Date() } : {}),
        ...(to === 'PUBLISHED' ? { publishedAt: new Date(), publishedById: v.userId } : {}),
      },
    })
  })
  if (to === 'IN_REVIEW') {
    try {
      const { notifyUsers, usersWithPermission } = await import('@/lib/notifications/events')
      const approvers = (await usersWithPermission('curriculum', 'approve')).filter((id) => id !== v.userId)
      await notifyUsers(approvers, 'CURRICULUM_REVIEW', { title: 'Curriculum waiting for review', message: `Curriculum version ${e.number} was sent for review.`, relatedId: e.levelId })
    } catch (err) { console.error('[CURRICULUM_NOTIFY]', err) }
  }
  return { ok: true, value: { status: to } }
}

export async function deleteDraft(v: Viewer, editionId: string): Promise<Outcome> {
  if (!v.canDelete) return fail('FORBIDDEN', 'You cannot delete curriculum')
  const e = await prisma.curriculumEdition.findUnique({ where: { id: editionId } })
  if (!e) return fail('NOT_FOUND', 'Version not found')
  if (e.status !== 'DRAFT') return fail('BAD_STATUS', 'Only a draft can be deleted')
  const sessionIds = (await prisma.curriculumSession.findMany({ where: { editionId }, select: { id: true } })).map((s) => s.id)
  await prisma.$transaction([
    prisma.curriculumBlock.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    prisma.curriculumComment.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    prisma.curriculumSession.deleteMany({ where: { editionId } }),
    prisma.curriculumEdition.delete({ where: { id: editionId } }),
  ])
  return { ok: true }
}

/** The edition a group reads: the one pinned to it, else the newest published edition of its level. */
export async function editionForGroup(classSectionId: string) {
  const g = await prisma.classSection.findUnique({ where: { id: classSectionId }, select: { levelId: true, curriculumEditionId: true } })
  if (!g) return null
  if (g.curriculumEditionId) {
    const pinned = await prisma.curriculumEdition.findUnique({ where: { id: g.curriculumEditionId } })
    if (pinned && (pinned.status === 'PUBLISHED' || pinned.status === 'ARCHIVED')) return pinned
  }
  if (!g.levelId) return null
  return prisma.curriculumEdition.findFirst({ where: { levelId: g.levelId, status: 'PUBLISHED' }, orderBy: { number: 'desc' } })
}

// ───────────────────────── sessions ─────────────────────────

async function editableSession(v: Viewer, sessionId: string) {
  if (!v.canEdit) return { err: fail('FORBIDDEN', 'You cannot write curriculum') }
  const s = await prisma.curriculumSession.findUnique({ where: { id: sessionId } })
  if (!s) return { err: fail('NOT_FOUND', 'Session not found') }
  const e = await prisma.curriculumEdition.findUnique({ where: { id: s.editionId } })
  if (!e) return { err: fail('NOT_FOUND', 'Version not found') }
  if (e.status !== 'DRAFT') return { err: fail('LOCKED', 'Only a draft can be changed — make a new version to edit a published curriculum') }
  return { s, e }
}

type BlockOut = { id: string; order: number; type: string; audience: string; titleEn: string | null; titleAr: string | null; data: Record<string, unknown> }

function withMediaUrl(data: Record<string, unknown>): Record<string, unknown> {
  const m = data.media as { publicId?: string; resourceType?: 'image' | 'video' | 'raw'; format?: string } | undefined
  if (!m?.publicId || !m.resourceType) return data
  try { return { ...data, mediaUrl: curriculumMediaUrl(m.publicId, m.resourceType, m.format) } } catch { return data }
}

/** One session with its blocks (instructor notes / instructor-only blocks removed for `as: 'STUDENT'`). */
export async function getSession(v: Viewer, sessionId: string, as: 'INSTRUCTOR' | 'STUDENT' = 'INSTRUCTOR') {
  const s = await prisma.curriculumSession.findUnique({ where: { id: sessionId } })
  if (!s) return null
  const e = await prisma.curriculumEdition.findUnique({ where: { id: s.editionId } })
  if (!e || !editionVisible(v, e)) return null
  const [blocks, siblings, comments, level] = await Promise.all([
    prisma.curriculumBlock.findMany({ where: { sessionId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }),
    prisma.curriculumSession.findMany({ where: { editionId: e.id }, orderBy: { number: 'asc' }, select: { id: true, number: true } }),
    v.canEdit || v.canApprove ? prisma.curriculumComment.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } }) : Promise.resolve([]),
    prisma.level.findUnique({ where: { id: e.levelId }, select: { id: true, name: true, subjectId: true, subject: { select: { name: true } } } }),
  ])
  const authors = comments.length ? await staffNames([...new Set(comments.map((c) => c.authorId))]) : new Map<string, string>()
  const outBlocks: BlockOut[] = blocks
    .filter((b) => visibleTo(b.audience, as))
    .map((b) => ({ id: b.id, order: b.order, type: b.type, audience: b.audience, titleEn: b.titleEn, titleAr: b.titleAr, data: withMediaUrl((b.data ?? {}) as Record<string, unknown>) }))
  const i = siblings.findIndex((x) => x.id === s.id)
  return {
    edition: { id: e.id, number: e.number, status: e.status, levelId: e.levelId },
    level,
    session: as === 'STUDENT' ? { ...s, instructorNotes: null } : s,
    blocks: outBlocks,
    prevId: siblings[i - 1]?.id ?? null,
    nextId: siblings[i + 1]?.id ?? null,
    editable: v.canEdit && e.status === 'DRAFT',
    comments: comments.map((c) => ({ ...c, authorName: authors.get(c.authorId) ?? '—' })),
  }
}

export interface SessionPatch {
  titleEn?: string; titleAr?: string; objectivesEn?: string | null; objectivesAr?: string | null
  materialsEn?: string | null; materialsAr?: string | null; instructorNotes?: string | null
  durationMin?: number | null; skillIds?: string[]
}

export async function updateSession(v: Viewer, sessionId: string, patch: SessionPatch): Promise<Outcome> {
  const r = await editableSession(v, sessionId)
  if (r.err) return r.err
  const { skillIds, ...rest } = patch
  await prisma.curriculumSession.update({
    where: { id: sessionId },
    data: { ...rest, ...(skillIds ? { skillIds: skillIds as Prisma.InputJsonValue } : {}) },
  })
  return { ok: true }
}

/** Adds a session at the end of a draft edition. */
export async function addSession(v: Viewer, editionId: string): Promise<Outcome<{ id: string }>> {
  if (!v.canEdit) return fail('FORBIDDEN', 'You cannot write curriculum')
  const e = await prisma.curriculumEdition.findUnique({ where: { id: editionId } })
  if (!e) return fail('NOT_FOUND', 'Version not found')
  if (e.status !== 'DRAFT') return fail('LOCKED', 'Only a draft can be changed')
  const last = await prisma.curriculumSession.findFirst({ where: { editionId }, orderBy: { number: 'desc' }, select: { number: true } })
  const s = await prisma.curriculumSession.create({ data: { editionId, number: (last?.number ?? 0) + 1 } })
  return { ok: true, value: { id: s.id } }
}

/** Removes a session of a draft edition (with its blocks) and renumbers the rest. */
export async function removeSession(v: Viewer, sessionId: string): Promise<Outcome> {
  const r = await editableSession(v, sessionId)
  if (r.err) return r.err
  await prisma.$transaction(async (tx) => {
    await tx.curriculumBlock.deleteMany({ where: { sessionId } })
    await tx.curriculumComment.deleteMany({ where: { sessionId } })
    await tx.curriculumSession.delete({ where: { id: sessionId } })
    const rest = await tx.curriculumSession.findMany({ where: { editionId: r.s!.editionId }, orderBy: { number: 'asc' }, select: { id: true, number: true } })
    // two passes so the unique (editionId, number) never collides
    for (const x of rest) await tx.curriculumSession.update({ where: { id: x.id }, data: { number: x.number + 10000 } })
    for (let i = 0; i < rest.length; i++) await tx.curriculumSession.update({ where: { id: rest[i].id }, data: { number: i + 1 } })
  })
  return { ok: true }
}

/** Copies a session (texts + blocks) right after itself in the same draft; later sessions move down by one. */
export async function duplicateSession(v: Viewer, sessionId: string): Promise<Outcome<{ id: string }>> {
  const r = await editableSession(v, sessionId)
  if (r.err) return r.err
  const src = r.s!
  const id = await prisma.$transaction(async (tx) => {
    const later = await tx.curriculumSession.findMany({ where: { editionId: src.editionId, number: { gt: src.number } }, orderBy: { number: 'desc' }, select: { id: true, number: true } })
    for (const x of later) await tx.curriculumSession.update({ where: { id: x.id }, data: { number: x.number + 1 } })
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = src
    const ns = await tx.curriculumSession.create({ data: { ...rest, skillIds: (src.skillIds ?? undefined) as Prisma.InputJsonValue, number: src.number + 1, titleEn: src.titleEn ? `${src.titleEn} (copy)`.slice(0, 200) : '', titleAr: src.titleAr ? `${src.titleAr} (نسخة)`.slice(0, 200) : '' } })
    const blocks = await tx.curriculumBlock.findMany({ where: { sessionId: src.id }, orderBy: { order: 'asc' } })
    if (blocks.length) {
      await tx.curriculumBlock.createMany({ data: blocks.map((b) => ({ sessionId: ns.id, order: b.order, type: b.type, audience: b.audience, titleEn: b.titleEn, titleAr: b.titleAr, data: b.data as Prisma.InputJsonValue })) })
    }
    return ns.id
  })
  return { ok: true, value: { id } }
}

// ───────────────────────── blocks ─────────────────────────

export interface BlockInput { type?: string; audience?: string; titleEn?: string | null; titleAr?: string | null; data?: unknown }

export async function addBlock(v: Viewer, sessionId: string, input: BlockInput): Promise<Outcome<{ id: string }>> {
  const r = await editableSession(v, sessionId)
  if (r.err) return r.err
  const check = validateBlockData(input.type ?? '', input.data)
  if (!check.ok) return fail('INVALID', check.message!)
  const last = await prisma.curriculumBlock.findFirst({ where: { sessionId }, orderBy: { order: 'desc' }, select: { order: true } })
  const b = await prisma.curriculumBlock.create({
    data: { sessionId, type: input.type!, audience: input.audience ?? 'BOTH', titleEn: input.titleEn ?? null, titleAr: input.titleAr ?? null, order: (last?.order ?? 0) + 1, data: check.data as Prisma.InputJsonValue },
  })
  return { ok: true, value: { id: b.id } }
}

export async function updateBlock(v: Viewer, blockId: string, input: BlockInput): Promise<Outcome> {
  const b = await prisma.curriculumBlock.findUnique({ where: { id: blockId } })
  if (!b) return fail('NOT_FOUND', 'Content not found')
  const r = await editableSession(v, b.sessionId)
  if (r.err) return r.err
  let data: Prisma.InputJsonValue | undefined
  if (input.data !== undefined) {
    const check = validateBlockData(b.type, input.data)
    if (!check.ok) return fail('INVALID', check.message!)
    data = check.data as Prisma.InputJsonValue
  }
  await prisma.curriculumBlock.update({
    where: { id: blockId },
    data: {
      ...(input.audience ? { audience: input.audience } : {}),
      ...(input.titleEn !== undefined ? { titleEn: input.titleEn } : {}),
      ...(input.titleAr !== undefined ? { titleAr: input.titleAr } : {}),
      ...(data !== undefined ? { data } : {}),
    },
  })
  return { ok: true }
}

export async function deleteBlock(v: Viewer, blockId: string): Promise<Outcome> {
  const b = await prisma.curriculumBlock.findUnique({ where: { id: blockId } })
  if (!b) return fail('NOT_FOUND', 'Content not found')
  const r = await editableSession(v, b.sessionId)
  if (r.err) return r.err
  await prisma.curriculumBlock.delete({ where: { id: blockId } })
  return { ok: true }
}

/** Saves a new order of the blocks of a session (ids in the wanted order). */
export async function reorderBlocks(v: Viewer, sessionId: string, ids: string[]): Promise<Outcome> {
  const r = await editableSession(v, sessionId)
  if (r.err) return r.err
  const existing = await prisma.curriculumBlock.findMany({ where: { sessionId }, select: { id: true } })
  if (existing.length !== ids.length || !existing.every((b) => ids.includes(b.id))) return fail('INVALID', 'The list of content does not match')
  await prisma.$transaction(ids.map((id, i) => prisma.curriculumBlock.update({ where: { id }, data: { order: i + 1 } })))
  return { ok: true }
}

// ───────────────────────── review comments ─────────────────────────

export async function addComment(v: Viewer, sessionId: string, body: string): Promise<Outcome> {
  if (!v.canEdit && !v.canApprove) return fail('FORBIDDEN', 'You cannot comment')
  const s = await prisma.curriculumSession.findUnique({ where: { id: sessionId }, select: { id: true } })
  if (!s) return fail('NOT_FOUND', 'Session not found')
  await prisma.curriculumComment.create({ data: { sessionId, authorId: v.userId, body: body.trim().slice(0, 5000) } })
  return { ok: true }
}

export async function setCommentResolved(v: Viewer, commentId: string, resolved: boolean): Promise<Outcome> {
  if (!v.canEdit && !v.canApprove) return fail('FORBIDDEN', 'You cannot change comments')
  const c = await prisma.curriculumComment.findUnique({ where: { id: commentId } })
  if (!c) return fail('NOT_FOUND', 'Comment not found')
  await prisma.curriculumComment.update({ where: { id: commentId }, data: { resolved } })
  return { ok: true }
}

// ───────────────────────── skills of a course ─────────────────────────

export const courseSkills = (subjectId: string) =>
  prisma.courseSkill.findMany({ where: { subjectId }, orderBy: [{ order: 'asc' }, { nameEn: 'asc' }] })

// ───────────────────────── export / import ─────────────────────────

export const EXPORT_FORMAT = 'technova-curriculum-v1'

export async function exportEdition(v: Viewer, editionId: string) {
  const e = await prisma.curriculumEdition.findUnique({ where: { id: editionId } })
  if (!e || !editionVisible(v, e) || !v.canEdit) return null
  const sessions = await prisma.curriculumSession.findMany({ where: { editionId }, orderBy: { number: 'asc' } })
  const blocks = await prisma.curriculumBlock.findMany({ where: { sessionId: { in: sessions.map((s) => s.id) } }, orderBy: { order: 'asc' } })
  return {
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    edition: { number: e.number, notes: e.notes },
    sessions: sessions.map((s) => ({
      number: s.number, titleEn: s.titleEn, titleAr: s.titleAr, objectivesEn: s.objectivesEn, objectivesAr: s.objectivesAr,
      materialsEn: s.materialsEn, materialsAr: s.materialsAr, instructorNotes: s.instructorNotes, durationMin: s.durationMin,
      blocks: blocks.filter((b) => b.sessionId === s.id).map((b) => ({ type: b.type, audience: b.audience, titleEn: b.titleEn, titleAr: b.titleAr, data: b.data })),
    })),
  }
}

export interface ImportFile {
  format: string
  notes?: string | null
  sessions: { titleEn?: string; titleAr?: string; objectivesEn?: string | null; objectivesAr?: string | null; materialsEn?: string | null; materialsAr?: string | null; instructorNotes?: string | null; durationMin?: number | null; blocks?: BlockInput[] }[]
}

/** Imports an exported file as a NEW draft edition of a level. Every block is validated again. */
export async function importEdition(v: Viewer, levelId: string, file: ImportFile): Promise<Outcome<{ id: string; number: number }>> {
  if (!v.canEdit) return fail('FORBIDDEN', 'You cannot write curriculum')
  if (file?.format !== EXPORT_FORMAT) return fail('INVALID', 'This is not a TechNova curriculum file')
  const level = await prisma.level.findUnique({ where: { id: levelId }, select: { id: true } })
  if (!level) return fail('NOT_FOUND', 'Level not found')
  const sessions = (file.sessions ?? []).slice(0, 200)
  if (!sessions.length) return fail('INVALID', 'The file has no sessions')
  for (const [i, s] of sessions.entries()) {
    for (const b of s.blocks ?? []) {
      const c = validateBlockData(b.type ?? '', b.data)
      if (!c.ok) return fail('INVALID', `Session ${i + 1}: ${c.message}`)
      b.data = c.data
    }
  }
  const created = await prisma.$transaction(async (tx) => {
    const last = await tx.curriculumEdition.findFirst({ where: { levelId }, orderBy: { number: 'desc' }, select: { number: true } })
    const number = (last?.number ?? 0) + 1
    const ed = await tx.curriculumEdition.create({ data: { levelId, number, status: 'DRAFT', notes: file.notes ?? 'Imported', createdById: v.userId } })
    for (const [i, s] of sessions.entries()) {
      const ns = await tx.curriculumSession.create({
        data: {
          editionId: ed.id, number: i + 1, titleEn: (s.titleEn ?? '').slice(0, 200), titleAr: (s.titleAr ?? '').slice(0, 200),
          objectivesEn: s.objectivesEn ?? null, objectivesAr: s.objectivesAr ?? null, materialsEn: s.materialsEn ?? null, materialsAr: s.materialsAr ?? null,
          instructorNotes: s.instructorNotes ?? null, durationMin: s.durationMin ?? null,
        },
      })
      const blocks = (s.blocks ?? []).slice(0, 100)
      if (blocks.length) {
        await tx.curriculumBlock.createMany({
          data: blocks.map((b, j) => ({
            sessionId: ns.id, order: j + 1, type: b.type!, audience: ['BOTH', 'INSTRUCTOR', 'STUDENT'].includes(b.audience ?? '') ? b.audience! : 'BOTH',
            titleEn: b.titleEn?.slice(0, 200) ?? null, titleAr: b.titleAr?.slice(0, 200) ?? null, data: b.data as Prisma.InputJsonValue,
          })),
        })
      }
    }
    return { id: ed.id, number }
  })
  return { ok: true, value: created }
}
