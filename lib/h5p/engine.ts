/**
 * L5 H5P activities (owner 2026-10-11). Server-only.
 * - Who may play: a student whose lesson is open in that group (module `lms` on); staff who read the curriculum
 *   (preview). Parents do not open lesson content.
 * - The player runs in a sandboxed frame; its score comes back through the parent page → POST /api/h5p/result.
 *   Best score kept; "completed" ticks the lesson item. Results feed the session report, skills and the task score.
 */

import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { isModuleOn } from '@/lib/platform/settings'
import { visibleTo } from '@/lib/curriculum/blocks'
import { groupLessons, studentLessonAccess } from '@/lib/lms/engine'

type User = { id: string; role: string }
export interface PlayAccess { ok: boolean; code?: string; message?: string; viewer?: string; publicId?: string; studentId?: string }

async function loadBlock(blockId: string) {
  const b = await prisma.curriculumBlock.findUnique({ where: { id: blockId }, select: { id: true, type: true, sessionId: true, audience: true, data: true } })
  if (!b || b.type !== 'H5P') return null
  const publicId = (b.data as { media?: { publicId?: string } } | null)?.media?.publicId
  return publicId ? { ...b, publicId } : null
}

export async function playAccess(user: User, blockId: string, groupId: string | null): Promise<PlayAccess> {
  const b = await loadBlock(blockId)
  if (!b) return { ok: false, code: 'NOT_FOUND', message: 'Activity not found' }
  const role = user.role as Role
  if (role === 'STUDENT') {
    if (!groupId) return { ok: false, code: 'NOT_FOUND', message: 'Group missing' }
    if (!(await isModuleOn('lms'))) return { ok: false, code: 'MODULE_OFF', message: 'Lessons are not switched on' }
    const s = await prisma.student.findFirst({ where: { userId: user.id }, select: { id: true } })
    if (!s || !visibleTo(b.audience, 'STUDENT')) return { ok: false, code: 'FORBIDDEN', message: 'Not allowed' }
    const a = await studentLessonAccess(s.id, groupId, b.sessionId)
    if (!a.ok) return { ok: false, code: a.code, message: a.message }
    return { ok: true, viewer: `S-${s.id}-${groupId}`, publicId: b.publicId, studentId: s.id }
  }
  if (role === 'PARENT' || role === 'GUARDIAN') return { ok: false, code: 'FORBIDDEN', message: 'Activities are played by the student' }
  if (!checkPermission(role, 'curriculum', 'read')) return { ok: false, code: 'FORBIDDEN', message: 'Not allowed' }
  return { ok: true, viewer: `U-${user.id}`, publicId: b.publicId }
}

/** The package link a token may read (token viewer must still match the block). */
export async function packageIdFor(blockId: string) {
  return (await loadBlock(blockId))?.publicId ?? null
}

export interface ResultInput { groupId: string; blockId: string; score?: number | null; maxScore?: number | null; completed?: boolean }

/** Saves a student's result (best score kept; completion ticks the lesson item). */
export async function saveResult(user: User, input: ResultInput): Promise<{ ok: boolean; code?: string; message?: string }> {
  const access = await playAccess(user, input.blockId, input.groupId)
  if (!access.ok || !access.studentId) return { ok: false, code: access.code ?? 'FORBIDDEN', message: access.message ?? 'Only the student saves a result' }
  const b = await loadBlock(input.blockId)
  const max = Number.isFinite(input.maxScore) && (input.maxScore as number) > 0 ? Math.min(input.maxScore as number, 10000) : null
  const score = max != null && Number.isFinite(input.score) ? Math.max(0, Math.min(input.score as number, max)) : null
  const key = { blockId_studentId_classSectionId: { blockId: input.blockId, studentId: access.studentId, classSectionId: input.groupId } }
  const old = await prisma.h5PResult.findUnique({ where: key })
  const better = score != null && max != null && (!old?.maxScore || old.score == null || score / max > old.score / old.maxScore)
  await prisma.h5PResult.upsert({
    where: key,
    create: { blockId: input.blockId, sessionId: b!.sessionId, classSectionId: input.groupId, studentId: access.studentId, score, maxScore: max, completed: !!input.completed, attempts: input.completed ? 1 : 0 },
    update: {
      ...(better ? { score, maxScore: max } : {}),
      ...(input.completed ? { completed: true, attempts: { increment: 1 } } : {}),
    },
  })
  if (input.completed) {
    await prisma.lessonProgress.upsert({
      where: { studentId_blockId: { studentId: access.studentId, blockId: input.blockId } },
      create: { studentId: access.studentId, blockId: input.blockId, sessionId: b!.sessionId, classSectionId: input.groupId },
      update: {},
    })
  }
  return { ok: true }
}

const pctOf = (r: { score: number | null; maxScore: number | null }) => (r.score != null && r.maxScore ? Math.round((r.score / r.maxScore) * 1000) / 10 : null)

/** Staff: every H5P activity of a group with each student's best result. */
export async function groupH5P(groupId: string) {
  const gl = await groupLessons(groupId)
  if (!gl?.edition) return { activities: [], students: [] }
  const blocks = await prisma.curriculumBlock.findMany({ where: { sessionId: { in: gl.sessions.map((s) => s.id) }, type: 'H5P' }, orderBy: { order: 'asc' }, select: { id: true, sessionId: true, titleEn: true, titleAr: true } })
  const [students, rows] = await Promise.all([
    prisma.studentEnrollment.findMany({ where: { classSectionId: groupId, status: 'ACTIVE' }, orderBy: { student: { firstName: 'asc' } }, select: { studentId: true, student: { select: { firstName: true, lastName: true } } } }),
    prisma.h5PResult.findMany({ where: { classSectionId: groupId, blockId: { in: blocks.map((b) => b.id) } } }),
  ])
  return {
    activities: blocks.map((b) => ({
      blockId: b.id, sessionNumber: gl.sessions.find((s) => s.id === b.sessionId)?.number ?? null, titleEn: b.titleEn, titleAr: b.titleAr,
      results: rows.filter((r) => r.blockId === b.id).map((r) => ({ studentId: r.studentId, percent: pctOf(r), completed: r.completed, attempts: r.attempts })),
    })),
    students: students.map((s) => ({ id: s.studentId, name: `${s.student.firstName} ${s.student.lastName}`.trim() })),
  }
}

/** One student's H5P results (with %) in some groups, optionally only some lessons. */
export async function studentH5P(studentId: string, groupIds: string[], sessionIds?: string[]) {
  const rows = await prisma.h5PResult.findMany({ where: { studentId, classSectionId: { in: groupIds }, ...(sessionIds ? { sessionId: { in: sessionIds } } : {}) } })
  return rows.map((r) => ({ blockId: r.blockId, sessionId: r.sessionId, score: r.score, maxScore: r.maxScore, percent: pctOf(r), completed: r.completed }))
}
