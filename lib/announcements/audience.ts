/**
 * 5-D: turn audiences + scope into the people who receive an announcement, and check that the sender may use that
 * scope (only their places; instructors only their groups). Server-only.
 */

import { prisma } from '@/lib/prisma'
import { loadPlaces } from '@/lib/places/server'
import { allowsCampus, type Places } from '@/lib/places/rules'
import { getTeacherByUserId, getTeacherClassSectionIds } from '@/lib/academic/teacher-scope'
import { STAFF_SCOPES, type Audience, type ScopeType } from './rules'

export interface Recipient { userId: string; studentId: string | null; kind: Audience }

const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'SECRETARY', 'ACCOUNTANT', 'MARKETING'] as const
const activeGroup = { status: 'ACTIVE' as const, isActive: true, levelId: { not: null } }

/** Active groups inside the scope (null = no group filter, i.e. the whole company). */
async function groupsInScope(scopeType: ScopeType, ids: string[]): Promise<{ id: string; campusId: string }[] | null> {
  const select = { id: true, campusId: true }
  switch (scopeType) {
    case 'COMPANY': return null
    case 'CAMPUS': return prisma.classSection.findMany({ where: { ...activeGroup, campusId: { in: ids } }, select })
    case 'PARTNER': return prisma.classSection.findMany({ where: { ...activeGroup, campus: { partnerId: { in: ids } } }, select })
    case 'TRACK': return prisma.classSection.findMany({ where: { ...activeGroup, level: { subject: { trackId: { in: ids } } } }, select })
    case 'COURSE': return prisma.classSection.findMany({ where: { ...activeGroup, level: { subjectId: { in: ids } } }, select })
    case 'LEVEL': return prisma.classSection.findMany({ where: { ...activeGroup, levelId: { in: ids } }, select })
    case 'GROUP': return prisma.classSection.findMany({ where: { id: { in: ids } }, select })
    case 'STUDENTS': return []
  }
}

/** Campus ids of a place-type scope (for staff / instructors of a branch or partner). */
async function campusesInScope(scopeType: ScopeType, ids: string[]): Promise<string[] | null> {
  if (scopeType === 'COMPANY') return null
  if (scopeType === 'CAMPUS') return ids
  if (scopeType === 'PARTNER') return (await prisma.campus.findMany({ where: { partnerId: { in: ids } }, select: { id: true } })).map((c) => c.id)
  return []
}

/**
 * The people reached. `places` (a branch sender): a track / course / level scope only reaches the groups in those places.
 */
export async function resolveRecipients(audiences: Audience[], scopeType: ScopeType, scopeIds: string[], places?: Places): Promise<Recipient[]> {
  const out = new Map<string, Recipient>()
  const add = (r: Recipient) => { if (!out.has(r.userId)) out.set(r.userId, r) }
  let groups = await groupsInScope(scopeType, scopeIds)
  if (groups && places && !places.all && ['TRACK', 'COURSE', 'LEVEL'].includes(scopeType)) {
    groups = groups.filter((g) => allowsCampus(places, g.campusId) || places.groupIds.includes(g.id))
  }
  const groupIds = groups?.map((g) => g.id) ?? null

  if (audiences.includes('PARENT') || audiences.includes('STUDENT')) {
    const students = await prisma.student.findMany({
      where: scopeType === 'STUDENTS'
        ? { id: { in: scopeIds } }
        : { enrollments: { some: { status: 'ACTIVE', ...(groupIds ? { classSectionId: { in: groupIds.length ? groupIds : ['__none__'] } } : { classSection: activeGroup }) } } },
      select: { id: true, userId: true, user: { select: { isActive: true } }, guardians: { select: { userId: true, isActive: true } } },
      orderBy: { createdAt: 'asc' },
    })
    for (const s of students) {
      if (audiences.includes('STUDENT') && s.userId && s.user?.isActive !== false) add({ userId: s.userId, studentId: s.id, kind: 'STUDENT' })
      if (audiences.includes('PARENT')) for (const g of s.guardians) if (g.isActive !== false) add({ userId: g.userId, studentId: s.id, kind: 'PARENT' })
    }
  }

  if (audiences.includes('TEACHER')) {
    let teachers: { userId: string }[] = []
    const campuses = await campusesInScope(scopeType, scopeIds)
    if (campuses === null) {
      teachers = await prisma.teacher.findMany({ where: { isActive: true }, select: { userId: true } })
    } else if (STAFF_SCOPES.includes(scopeType)) {
      teachers = await prisma.teacher.findMany({
        where: { isActive: true, OR: [{ campusId: { in: campuses } }, { user: { allLocations: true } }, { user: { placeAccess: { some: { campusId: { in: campuses } } } } }] },
        select: { userId: true },
      })
    } else {
      // the instructors of the groups in the scope (the group's instructor offering)
      const ids = scopeType === 'STUDENTS'
        ? (await prisma.studentEnrollment.findMany({ where: { studentId: { in: scopeIds }, status: 'ACTIVE' }, select: { classSectionId: true } })).map((e) => e.classSectionId)
        : groupIds ?? []
      const offerings = ids.length ? await prisma.subjectOffering.findMany({ where: { classSectionId: { in: ids }, teacherId: { not: null } }, select: { teacher: { select: { userId: true, isActive: true } } } }) : []
      teachers = offerings.filter((o) => o.teacher && o.teacher.isActive).map((o) => ({ userId: o.teacher!.userId }))
    }
    for (const t of teachers) add({ userId: t.userId, studentId: null, kind: 'TEACHER' })
  }

  if (audiences.includes('STAFF')) {
    const campuses = await campusesInScope(scopeType, scopeIds)
    const users = await prisma.user.findMany({
      where: {
        isActive: true, role: { in: [...STAFF_ROLES] },
        ...(campuses === null ? {} : { OR: [{ allLocations: true }, { admin: { campusId: { in: campuses } } }, { placeAccess: { some: { campusId: { in: campuses } } } }] }),
      },
      select: { id: true },
    })
    for (const u of users) add({ userId: u.id, studentId: null, kind: 'STAFF' })
  }
  return [...out.values()]
}

/**
 * May this person send to these scope items? Branch staff: only inside their places. Instructors: only their groups.
 * Returns an English problem or null.
 */
export async function scopeProblem(user: { id: string; role: string }, scopeType: ScopeType, scopeIds: string[]): Promise<string | null> {
  if (user.role === 'TEACHER') {
    const t = await getTeacherByUserId(user.id)
    const mine = new Set(t ? await getTeacherClassSectionIds(t.id) : [])
    return scopeIds.every((id) => mine.has(id)) ? null : 'You can send only to your own groups'
  }
  const places: Places = await loadPlaces(user)
  if (places.all) return null
  if (scopeType === 'COMPANY') return 'Only someone with every place can send to the whole company'
  const okCampus = (id: string | null | undefined) => allowsCampus(places, id)
  switch (scopeType) {
    case 'CAMPUS': return scopeIds.every(okCampus) ? null : 'One of the places is not yours'
    case 'PARTNER': {
      const camps = await prisma.campus.findMany({ where: { partnerId: { in: scopeIds } }, select: { id: true, partnerId: true } })
      return scopeIds.every((p) => camps.some((c) => c.partnerId === p && okCampus(c.id))) ? null : 'One of the partners has no place of yours'
    }
    case 'GROUP': {
      const gs = await prisma.classSection.findMany({ where: { id: { in: scopeIds } }, select: { id: true, campusId: true } })
      return gs.length === scopeIds.length && gs.every((g) => okCampus(g.campusId) || places.groupIds.includes(g.id)) ? null : 'One of the groups is not in your places'
    }
    case 'STUDENTS': {
      const ss = await prisma.student.findMany({ where: { id: { in: scopeIds } }, select: { campusId: true } })
      return ss.length === scopeIds.length && ss.every((s) => okCampus(s.campusId)) ? null : 'One of the students is not in your places'
    }
    default:
      // tracks / courses / levels: a branch person reaches only the groups in their places (resolveRecipients(..., places))
      return null
  }
}
