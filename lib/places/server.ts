/**
 * M0 places & access — server side. Loads a person's places from the database (cached 30 s like the session guard) and
 * applies the header filter (cookie `tn_place`). Pure rules: lib/places/rules.ts. Use these helpers in every route
 * that lists or opens branch data instead of reading `session.user.campusId` directly.
 */

import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { narrow, resolvePlaces, type Places, allowsCampus, allowsGroup, TEACHER_STUDENT_STATUSES } from './rules'

export * from './rules'

const TTL = 30_000
const cache = new Map<string, { at: number; places: Places }>()
export const PLACE_COOKIE = 'tn_place'

type Who = { id: string; role: string }

/** The places a person may see (no header filter). */
export async function loadPlaces(user: Who): Promise<Places> {
  const key = `${user.id}:${user.role}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.places
  const [u, extra, groups] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        allLocations: true,
        admin: { select: { campusId: true } }, teacher: { select: { id: true, campusId: true } }, accountant: { select: { campusId: true } },
        branchManager: { select: { campusId: true } }, secretary: { select: { campusId: true } }, marketingStaff: { select: { campusId: true } },
      },
    }),
    prisma.userPlaceAccess.findMany({ where: { userId: user.id }, select: { campusId: true } }),
    prisma.userGroupAccess.findMany({ where: { userId: user.id }, select: { classSectionId: true } }),
  ])
  const primary = u?.admin?.campusId ?? u?.teacher?.campusId ?? u?.accountant?.campusId ?? u?.branchManager?.campusId ?? u?.secretary?.campusId ?? u?.marketingStaff?.campusId ?? null
  // instructors: the groups they teach or cover (owner 2026-10-24 — they see only these groups' students)
  let teacherGroups: string[] | undefined
  let allCampuses: string[] | undefined
  if (user.role === 'TEACHER') {
    const tid = u?.teacher?.id ?? '__none__'
    const [teaches, covers, campuses] = await Promise.all([
      prisma.subjectOffering.findMany({ where: { teacherId: tid }, select: { classSectionId: true } }),
      prisma.substituteAssignment.findMany({ where: { substituteTeacherId: tid, status: { in: ['CONFIRMED', 'PENDING_SUBSTITUTE_APPROVAL'] } }, select: { classSectionId: true } }),
      u?.allLocations ? prisma.campus.findMany({ where: { isActive: true }, select: { id: true } }) : Promise.resolve([]),
    ])
    teacherGroups = [...teaches, ...covers].map((r) => r.classSectionId).filter((x): x is string => !!x)
    allCampuses = campuses.map((c) => c.id)
  }
  const places = resolvePlaces({ role: user.role, allLocations: !!u?.allLocations, primary, extra: extra.map((e) => e.campusId), groups: groups.map((g) => g.classSectionId), teacherGroups, allCampuses })
  cache.set(key, { at: Date.now(), places })
  if (cache.size > 5000) cache.delete(cache.keys().next().value as string)
  return places
}

export function forgetPlaces(userId: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(`${userId}:`)) cache.delete(k)
}

async function selectedPlace(): Promise<string | null> {
  try { return (await cookies()).get(PLACE_COOKIE)?.value ?? null } catch { return null }
}

/**
 * The places for this request: the person's places, narrowed by an explicit `requested` campus (a filter in the page)
 * or else by the header filter. A request for a place the person may not see is ignored (they keep their own places);
 * use `allowsCampus` when you must refuse it.
 */
export async function requestPlaces(user: Who, requested?: string | null): Promise<Places> {
  const mine = await loadPlaces(user)
  if (requested) return narrow(mine, requested)
  return narrow(mine, await selectedPlace())
}

/** May this person open this group? (its place, or a single group given to them) */
export async function canSeeGroup(user: Who, groupId: string): Promise<boolean> {
  const p = await loadPlaces(user)
  if (p.all) return true
  const g = await prisma.classSection.findUnique({ where: { id: groupId }, select: { id: true, campusId: true } })
  if (!g) return false
  if (allowsGroup(p, g)) return true
  // an instructor always sees the groups he teaches or covers, wherever they are
  if (user.role === 'TEACHER') {
    const t = await prisma.teacher.findUnique({ where: { userId: user.id }, select: { id: true } })
    if (!t) return false
    const [teaches, covers] = await Promise.all([
      prisma.subjectOffering.count({ where: { classSectionId: groupId, teacherId: t.id } }),
      prisma.substituteAssignment.count({ where: { classSectionId: groupId, substituteTeacherId: t.id, status: 'CONFIRMED' } }),
    ])
    return teaches + covers > 0
  }
  return false
}

/** May this person open this student? (the student's place, or enrolled in one of their single groups) */
export async function canSeeStudent(user: Who, studentId: string): Promise<boolean> {
  const p = await loadPlaces(user)
  if (p.onlyGroups) return p.onlyGroups.length > 0 && (await prisma.studentEnrollment.count({ where: { studentId, classSectionId: { in: p.onlyGroups }, status: { in: [...TEACHER_STUDENT_STATUSES] } } })) > 0
  if (p.all) return true
  const s = await prisma.student.findUnique({ where: { id: studentId }, select: { campusId: true } })
  if (s && allowsCampus(p, s.campusId)) return true
  if (!p.groupIds.length) return false
  return (await prisma.studentEnrollment.count({ where: { studentId, classSectionId: { in: p.groupIds } } })) > 0
}

/** The places an instructor serves (primary + extra, or all). */
export async function teacherPlaces(teacherId: string): Promise<{ all: boolean; campusIds: string[] }> {
  const t = await prisma.teacher.findUnique({ where: { id: teacherId }, select: { campusId: true, userId: true, user: { select: { allLocations: true } } } })
  if (!t) return { all: false, campusIds: [] }
  if (t.user?.allLocations) return { all: true, campusIds: [] }
  const extra = await prisma.userPlaceAccess.findMany({ where: { userId: t.userId }, select: { campusId: true } })
  return { all: false, campusIds: [...new Set([t.campusId, ...extra.map((e) => e.campusId)])] }
}

/** Prisma where for instructors who serve a place. */
export function teachersOfPlaceWhere(campusId: string) {
  return { OR: [{ campusId }, { user: { allLocations: true } }, { user: { placeAccess: { some: { campusId } } } }] }
}

/** May this person open this invoice? (its group's place, or the student's place for an invoice without a group) */
export async function canSeeInvoice(user: Who, invoiceId: string): Promise<boolean> {
  const p = await loadPlaces(user)
  if (p.all) return true
  const inv = await prisma.feeInvoice.findUnique({ where: { id: invoiceId }, select: { classSectionId: true, studentId: true } })
  if (!inv) return false
  return inv.classSectionId ? canSeeGroup(user, inv.classSectionId) : canSeeStudent(user, inv.studentId)
}

/** Ids of the students this person may see (null = every student). For tables without a student relation. */
export async function visibleStudentIds(p: Places): Promise<string[] | null> {
  if (p.all) return null
  const { studentWhere } = await import('./rules')
  return (await prisma.student.findMany({ where: studentWhere(p), select: { id: true } })).map((s) => s.id)
}

/** May this person open this instructor? (serves one of their places, or teaches one of their single groups) */
export async function canSeeTeacher(user: Who, teacherId: string): Promise<boolean> {
  const p = await loadPlaces(user)
  if (p.all) return true
  const { teacherWhere } = await import('./rules')
  return (await prisma.teacher.count({ where: { id: teacherId, ...teacherWhere(p) } })) > 0
}

/** May this person manage this account? (see userWhere) */
export async function canSeeUser(user: Who, userId: string): Promise<boolean> {
  const p = await loadPlaces(user)
  if (p.all || userId === user.id) return true
  const { userWhere } = await import('./rules')
  return (await prisma.user.count({ where: { id: userId, ...userWhere(p, user.id) } })) > 0
}

/** Ids of the accounts this person may see (null = every account). For tables that keep a user id without a relation. */
export async function visibleUserIds(user: Who): Promise<string[] | null> {
  const p = await loadPlaces(user)
  if (p.all) return null
  const { userWhere } = await import('./rules')
  return (await prisma.user.findMany({ where: userWhere(p, user.id), select: { id: true } })).map((u) => u.id)
}

/** Ids of the groups this person may see (null = every group). For tables that keep a group id without a relation. */
export async function visibleGroupIds(p: Places): Promise<string[] | null> {
  if (p.all) return null
  const { groupWhere } = await import('./rules')
  return (await prisma.classSection.findMany({ where: groupWhere(p), select: { id: true } })).map((g) => g.id)
}
