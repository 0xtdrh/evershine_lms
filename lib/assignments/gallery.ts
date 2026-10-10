/**
 * LMS L3 batch 2 — projects gallery (owner 2026-10-10). Server-only.
 * Only hand-ins the instructor approved (galleryStatus APPROVED). Who sees one depends on its group's homework rules
 * (gallery: OWN = the student + family, GROUP = the group, ALL = every TechNova student / parent). Students marked
 * "no marketing" are never shown outside their own group. First name only, emoji reactions only (no comments).
 */

import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { getChildrenForGuardianUser } from '@/lib/academic/guardian'
import { policyForGroup } from './engine'
import { LESSON_ENROLLMENT_STATUSES } from '@/lib/lms/engine'

export const GALLERY_EMOJIS = ['👏', '❤️', '🤩', '🔥', '⭐'] as const

interface Viewer { userId: string; role: string; studentIds: string[]; groupIds: string[]; staff: boolean }

export async function galleryViewer(user: { id: string; role: string }): Promise<Viewer | null> {
  if (user.role === 'STUDENT') {
    const s = await prisma.student.findFirst({ where: { userId: user.id }, select: { id: true } })
    if (!s) return null
    return { userId: user.id, role: user.role, studentIds: [s.id], groupIds: await groupsOf([s.id]), staff: false }
  }
  if (user.role === 'PARENT' || user.role === 'GUARDIAN') {
    const kids = (await getChildrenForGuardianUser(user.id)).map((k) => k.id)
    return { userId: user.id, role: user.role, studentIds: kids, groupIds: await groupsOf(kids), staff: false }
  }
  if (checkPermission(user.role, 'curriculum', 'read')) return { userId: user.id, role: user.role, studentIds: [], groupIds: [], staff: true }
  return null
}

async function groupsOf(studentIds: string[]) {
  if (!studentIds.length) return []
  const e = await prisma.studentEnrollment.findMany({ where: { studentId: { in: studentIds }, status: { in: [...LESSON_ENROLLMENT_STATUSES] } }, select: { classSectionId: true } })
  return [...new Set(e.map((x) => x.classSectionId))]
}

/** May this viewer see this approved hand-in? */
export async function canSeeGalleryItem(v: Viewer, sub: { studentId: string; classSectionId: string; galleryStatus: string | null }, cache = new Map<string, string>()): Promise<boolean> {
  if (sub.galleryStatus !== 'APPROVED') return false
  if (v.staff || v.studentIds.includes(sub.studentId)) return true
  let scope = cache.get(sub.classSectionId)
  if (!scope) { scope = (await policyForGroup(sub.classSectionId)).gallery; cache.set(sub.classSectionId, scope) }
  const sameGroup = v.groupIds.includes(sub.classSectionId)
  if (scope === 'GROUP') return sameGroup
  if (scope === 'ALL') {
    if (sameGroup) return true
    const s = await prisma.student.findUnique({ where: { id: sub.studentId }, select: { noMarketing: true } })
    return !s?.noMarketing
  }
  return false
}

export async function galleryItems(v: Viewer, opts: { groupId?: string | null; take?: number } = {}) {
  const subs = await prisma.assignmentSubmission.findMany({
    where: { galleryStatus: 'APPROVED', ...(opts.groupId ? { classSectionId: opts.groupId } : {}) },
    orderBy: { galleryAt: 'desc' },
    take: Math.min(opts.take ?? 60, 200),
    select: { id: true, blockId: true, studentId: true, classSectionId: true, galleryStatus: true, galleryAt: true, files: true, links: true, code: true, text: true },
  })
  const cache = new Map<string, string>()
  const visible = []
  for (const s of subs) if (await canSeeGalleryItem(v, s, cache)) visible.push(s)
  if (!visible.length) return []
  const [students, blocks, groups, reactions] = await Promise.all([
    prisma.student.findMany({ where: { id: { in: visible.map((s) => s.studentId) } }, select: { id: true, firstName: true } }),
    prisma.curriculumBlock.findMany({ where: { id: { in: visible.map((s) => s.blockId) } }, select: { id: true, titleEn: true, titleAr: true } }),
    prisma.classSection.findMany({ where: { id: { in: visible.map((s) => s.classSectionId) } }, select: { id: true, level: { select: { name: true, subject: { select: { name: true } } } } } }),
    prisma.galleryReaction.findMany({ where: { submissionId: { in: visible.map((s) => s.id) } }, select: { submissionId: true, userId: true, emoji: true } }),
  ])
  return visible.map((s) => {
    const files = ((s.files as { resourceType: string; originalName?: string }[] | null) ?? [])
    const imageIndex = files.findIndex((f) => f.resourceType === 'image')
    const videoIndex = files.findIndex((f) => f.resourceType === 'video')
    const g = groups.find((x) => x.id === s.classSectionId)
    const mine = reactions.filter((r) => r.submissionId === s.id)
    return {
      id: s.id,
      firstName: students.find((x) => x.id === s.studentId)?.firstName ?? '',
      titleEn: blocks.find((b) => b.id === s.blockId)?.titleEn ?? null, titleAr: blocks.find((b) => b.id === s.blockId)?.titleAr ?? null,
      course: g?.level?.subject?.name ?? '', level: g?.level?.name ?? '',
      image: imageIndex >= 0 ? `/api/assignments/files/${s.id}?i=${imageIndex}` : null,
      video: videoIndex >= 0 ? `/api/assignments/files/${s.id}?i=${videoIndex}` : null,
      link: ((s.links as string[] | null) ?? [])[0] ?? null,
      code: s.code ? s.code.slice(0, 1200) : null,
      text: s.text ? s.text.slice(0, 400) : null,
      reactions: Object.fromEntries(GALLERY_EMOJIS.map((e) => [e, mine.filter((r) => r.emoji === e).length])),
      myReactions: mine.filter((r) => r.userId === v.userId).map((r) => r.emoji),
      own: v.studentIds.includes(s.studentId),
      at: s.galleryAt,
    }
  })
}

export async function toggleReaction(v: Viewer, submissionId: string, emoji: string): Promise<{ ok: boolean; message?: string }> {
  if (!(GALLERY_EMOJIS as readonly string[]).includes(emoji)) return { ok: false, message: 'Unknown reaction' }
  const s = await prisma.assignmentSubmission.findUnique({ where: { id: submissionId }, select: { studentId: true, classSectionId: true, galleryStatus: true } })
  if (!s || !(await canSeeGalleryItem(v, s))) return { ok: false, message: 'Not found' }
  const existing = await prisma.galleryReaction.findUnique({ where: { submissionId_userId_emoji: { submissionId, userId: v.userId, emoji } } })
  if (existing) await prisma.galleryReaction.delete({ where: { id: existing.id } })
  else await prisma.galleryReaction.create({ data: { submissionId, userId: v.userId, emoji } })
  return { ok: true }
}
