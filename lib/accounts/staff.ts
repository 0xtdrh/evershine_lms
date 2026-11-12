/**
 * Six phases 1-A: family accounts on the staff side (server only). Places: an account with no registered student yet is a new
 * family the whole company may serve; an account with students follows their places (M0 rules).
 */

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { errors } from '@/lib/api-response'
import { checkPermission, normalizeRole, type Action } from '@/lib/rbac'
import { loadPlaces, studentWhere } from '@/lib/places/server'
import { familyOf } from './engine'

type Who = { id: string; role: string }

export async function staffSession(action: Action) {
  const session = await auth()
  if (!session?.user) return { error: errors.unauthorized() } as const
  const role = normalizeRole(session.user.role)
  if (!role || !checkPermission(role, 'family_accounts', action)) return { error: errors.forbidden() } as const
  return { error: null, session, user: { id: session.user.id, role: session.user.role } as Who } as const
}

async function placeWhere(user: Who) {
  const p = await loadPlaces(user)
  if (p.all) return {}
  return { OR: [{ students: { none: {} } }, { students: { some: studentWhere(p) } }] }
}

export async function canSeeAccount(user: Who, guardianId: string) {
  return (await prisma.guardian.count({ where: { AND: [{ id: guardianId }, await placeWhere(user)] } })) > 0
}

export type AccountFilter = 'ALL' | 'WEBSITE' | 'STAFF' | 'NO_BOOKING'

export async function listAccounts(user: Who, opts: { q?: string | null; filter?: AccountFilter }) {
  const q = opts.q?.trim()
  const filter = opts.filter ?? 'ALL'
  const rows = await prisma.guardian.findMany({
    where: {
      AND: [
        await placeWhere(user),
        filter === 'WEBSITE' ? { signupSource: 'WEBSITE' } : filter === 'STAFF' ? { signupSource: 'STAFF' } : filter === 'NO_BOOKING' ? { students: { none: {} } } : {},
        q ? { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { phoneNumber: { contains: q.replace(/\s/g, '') } }, { email: { contains: q } }, { members: { some: { firstName: { contains: q } } } }] } : {},
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 150,
    select: {
      id: true, firstName: true, lastName: true, phoneNumber: true, email: true, signupSource: true, selfAccount: true, country: true, city: true, createdAt: true,
      user: { select: { lastLogin: true, emailVerified: true } },
      _count: { select: { members: true, students: true } },
    },
  })
  return rows.map((r) => ({ ...r, members: r._count.members, students: r._count.students, lastLogin: r.user.lastLogin, emailVerified: r.user.emailVerified }))
}

export async function accountDetail(guardianId: string) {
  const g = await prisma.guardian.findUnique({
    where: { id: guardianId },
    select: { id: true, firstName: true, lastName: true, phoneNumber: true, email: true, relationship: true, signupSource: true, selfAccount: true, country: true, city: true, createdAt: true, user: { select: { lastLogin: true, emailVerified: true, isActive: true } } },
  })
  if (!g) return null
  const [people, unlocks, link, tracks, courses] = await Promise.all([
    familyOf(guardianId),
    prisma.courseUnlock.findMany({ where: { OR: [{ guardianId }, { memberId: { in: (await prisma.familyMember.findMany({ where: { guardianId }, select: { id: true } })).map((m) => m.id) } }, { studentId: { in: (await prisma.student.findMany({ where: { guardians: { some: { id: guardianId } } }, select: { id: true } })).map((s) => s.id) } }] }, orderBy: { createdAt: 'desc' } }),
    prisma.accountSetupLink.findFirst({ where: { guardianId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, expiresAt: true, usedAt: true } }),
    prisma.track.findMany({ where: { isActive: true }, select: { id: true, name: true, minAge: true, maxAge: true }, orderBy: { name: 'asc' } }),
    prisma.academicSubject.findMany({ where: { isActive: true }, select: { id: true, name: true, trackId: true }, orderBy: { name: 'asc' } }),
  ])
  const nameOf = (u: { refType: string; refId: string }) => (u.refType === 'TRACK' ? tracks.find((t) => t.id === u.refId)?.name : courses.find((c) => c.id === u.refId)?.name) ?? u.refId
  return {
    account: g, people,
    unlocks: unlocks.map((u) => ({ ...u, name: nameOf(u), forWho: u.guardianId ? 'FAMILY' : people.find((p) => (u.memberId && p.memberId === u.memberId) || (u.studentId && p.studentId === u.studentId))?.firstName ?? '—' })),
    link, options: { tracks, courses },
  }
}
