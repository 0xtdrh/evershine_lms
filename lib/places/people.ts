/**
 * Partners part 1-B2: the groups, students and instructors of one or more places (a branch, a partner place, or all
 * places of a partner) — for the tabs on the place and partner pages. Server-only.
 */

import { prisma } from '@/lib/prisma'
import { teachersOfPlaceWhere } from './server'

export async function placePeople(campusIds: string[]) {
  if (!campusIds.length) return { groups: [], students: [], instructors: [] }
  const [groups, students, instructors] = await Promise.all([
    prisma.classSection.findMany({
      where: { campusId: { in: campusIds }, isActive: true },
      orderBy: [{ status: 'asc' }, { className: 'asc' }],
      select: {
        id: true, className: true, sectionName: true, status: true, startDate: true, scheduleSlots: true, unnamedHeadcount: true,
        campus: { select: { id: true, name: true } },
        level: { select: { name: true, subject: { select: { name: true } } } },
        _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
      },
    }),
    prisma.student.findMany({
      where: { campusId: { in: campusIds } },
      orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }],
      take: 1000,
      select: {
        id: true, firstName: true, lastName: true, registrationNumber: true, isActive: true,
        campus: { select: { id: true, name: true } },
        enrollments: { where: { status: 'ACTIVE' }, select: { id: true, classSection: { select: { id: true, className: true, sectionName: true } } } },
      },
    }),
    prisma.teacher.findMany({
      where: { isActive: true, OR: campusIds.map((c) => teachersOfPlaceWhere(c)) },
      orderBy: { firstName: 'asc' },
      select: { id: true, firstName: true, lastName: true, phoneNumber: true, campusId: true, campus: { select: { name: true } }, user: { select: { allLocations: true, placeAccess: { select: { campusId: true } } } } },
    }),
  ])
  const offerings = groups.length
    ? await prisma.subjectOffering.findMany({
        where: { classSectionId: { in: groups.map((g) => g.id) }, teacherId: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { classSectionId: true, teacher: { select: { id: true, firstName: true, lastName: true } } },
      })
    : []
  const teacherOf = new Map<string, { id: string; name: string }>()
  for (const o of offerings) if (o.teacher && !teacherOf.has(o.classSectionId)) teacherOf.set(o.classSectionId, { id: o.teacher.id, name: `${o.teacher.firstName} ${o.teacher.lastName}`.trim() })
  return {
    groups: groups.map((g) => ({
      id: g.id, name: `${g.className} ${g.sectionName}`.trim(), status: g.status, started: !!g.startDate, schedule: g.scheduleSlots,
      campus: g.campus, level: g.level ? `${g.level.subject?.name ?? ''} › ${g.level.name}` : null,
      students: g.unnamedHeadcount ?? g._count.enrollments, unnamed: g.unnamedHeadcount !== null, instructor: teacherOf.get(g.id) ?? null,
    })),
    students: students.map((s) => ({
      id: s.id, name: `${s.firstName} ${s.lastName}`.trim(), registrationNumber: s.registrationNumber, isActive: s.isActive, campus: s.campus,
      groups: s.enrollments.map((e) => ({ enrollmentId: e.id, id: e.classSection.id, name: `${e.classSection.className} ${e.classSection.sectionName}`.trim() })),
    })),
    instructors: instructors.map((t) => ({
      id: t.id, name: `${t.firstName} ${t.lastName}`.trim(), phone: t.phoneNumber, primary: { id: t.campusId, name: t.campus?.name ?? '' },
      allPlaces: !!t.user?.allLocations,
      places: campusIds.filter((c) => c === t.campusId || t.user?.placeAccess.some((p) => p.campusId === c)),
      groups: [...teacherOf.entries()].filter(([, v]) => v.id === t.id).length,
    })),
  }
}
