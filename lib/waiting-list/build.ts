/**
 * Builds the Waiting List page data.
 *
 * Every active student lands in AT MOST ONE bucket:
 *  - placed: ACTIVE enrollment in a group that has started      -> not shown
 *  - upcoming: ACTIVE enrollment only in groups not started yet -> "waiting for their group to start"
 *  - finished: last ACTIVE enrollment is in a COMPLETED group   -> "finished and did not continue"
 *  - notInGroup: none of the above                              -> "not in a group"
 * Wishes (WaitingListEntry, status WAITING) are shown separately and also
 * attached to the student in whichever bucket they are.
 *
 * byLevel: one waiting list per course / level = wishes for it + students
 * whose NEXT level (after finishing) is it + students in its upcoming groups.
 */

import { prisma } from '@/lib/prisma'
import { getNextStep } from '@/lib/groups/next-step'

const DAY_MS = 24 * 60 * 60 * 1000

function daysSince(date: Date | null | undefined) {
  return date ? Math.max(0, Math.floor((Date.now() - date.getTime()) / DAY_MS)) : null
}

function ageOf(dob: Date | null | undefined) {
  if (!dob) return null
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const m = now.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--
  return age
}

export interface WaitingStudent {
  id: string
  name: string
  registrationNumber: string
  age: number | null
  phone: string | null
  campus: { id: string; name: string }
  registeredAt: string
}

export async function buildWaitingList(opts: { campusId?: string; subjectId?: string }) {
  const students = await prisma.student.findMany({
    where: { isActive: true, ...(opts.campusId ? { campusId: opts.campusId } : {}) },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      fullNameAr: true,
      registrationNumber: true,
      dateOfBirth: true,
      phoneNumber: true,
      admissionDate: true,
      campus: { select: { id: true, name: true } },
      guardians: { select: { phoneNumber: true }, take: 1 },
      enrollments: {
        where: { status: 'ACTIVE' },
        select: {
          createdAt: true,
          classSection: {
            select: {
              id: true,
              className: true,
              sectionName: true,
              status: true,
              startDate: true,
              completedAt: true,
              currentCycleNumber: true,
              scheduleSlots: true,
              campus: { select: { id: true, name: true } },
              level: {
                select: {
                  id: true, name: true, order: true, subjectId: true, numberOfMonths: true, pricingType: true,
                  subject: { select: { id: true, name: true, trackId: true, trackOrder: true } },
                },
              },
            },
          },
        },
      },
      waitingListEntries: {
        where: { status: 'WAITING' },
        select: {
          id: true, notes: true, createdAt: true, campusId: true,
          subject: { select: { id: true, name: true } },
          level: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { admissionDate: 'asc' },
  })

  const now = Date.now()
  const shapeStudent = (s: (typeof students)[number]): WaitingStudent => ({
    id: s.id,
    name: s.fullNameAr || `${s.firstName} ${s.lastName}`.trim(),
    registrationNumber: s.registrationNumber,
    age: ageOf(s.dateOfBirth),
    phone: s.guardians[0]?.phoneNumber ?? s.phoneNumber ?? null,
    campus: s.campus,
    registeredAt: s.admissionDate.toISOString(),
  })
  const shapeWishes = (s: (typeof students)[number]) =>
    s.waitingListEntries.map((e) => ({
      id: e.id,
      course: e.subject,
      level: e.level,
      notes: e.notes,
      createdAt: e.createdAt.toISOString(),
      daysWaiting: daysSince(e.createdAt),
    }))

  const upcomingByGroup = new Map<string, {
    group: { id: string; label: string; campus: { id: string; name: string }; course: { id: string; name: string } | null; level: { id: string; name: string } | null; cycleNumber: number; scheduleSlots: unknown }
    students: Array<WaitingStudent & { addedAt: string; daysWaiting: number | null }>
  }>()
  const notInGroup: Array<WaitingStudent & { daysWaiting: number | null; wishes: ReturnType<typeof shapeWishes> }> = []
  const finishedRaw: Array<{ s: (typeof students)[number]; cs: NonNullable<(typeof students)[number]['enrollments'][number]['classSection']> }> = []

  for (const s of students) {
    const groups = s.enrollments.map((e) => ({ ...e.classSection, joinedAt: e.createdAt }))
    const running = groups.filter((g) => g.status === 'ACTIVE')
    const started = running.filter((g) => g.startDate && g.startDate.getTime() <= now)
    if (started.length) continue

    if (running.length) {
      for (const g of running) {
        const entry = upcomingByGroup.get(g.id) ?? {
          group: {
            id: g.id,
            label: `${g.className} ${g.sectionName}`.trim(),
            campus: g.campus,
            course: g.level?.subject ? { id: g.level.subject.id, name: g.level.subject.name } : null,
            level: g.level ? { id: g.level.id, name: g.level.name } : null,
            cycleNumber: g.currentCycleNumber,
            scheduleSlots: g.scheduleSlots,
          },
          students: [],
        }
        entry.students.push({ ...shapeStudent(s), addedAt: g.joinedAt.toISOString(), daysWaiting: daysSince(g.joinedAt) })
        upcomingByGroup.set(g.id, entry)
      }
      continue
    }

    const completed = groups
      .filter((g) => g.status === 'COMPLETED')
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
    if (completed.length) {
      finishedRaw.push({ s, cs: completed[0] })
      continue
    }

    notInGroup.push({ ...shapeStudent(s), daysWaiting: daysSince(s.admissionDate), wishes: shapeWishes(s) })
  }

  // Next step per (level, cycle), computed once each.
  const nextCache = new Map<string, Awaited<ReturnType<typeof getNextStep>>>()
  const finished = []
  for (const { s, cs } of finishedRaw) {
    let next: Awaited<ReturnType<typeof getNextStep>> = null
    if (cs.level) {
      const key = `${cs.level.id}:${cs.currentCycleNumber}`
      if (!nextCache.has(key)) {
        nextCache.set(key, await getNextStep({ ...cs.level, pricingType: cs.level.pricingType }, cs.currentCycleNumber))
      }
      next = nextCache.get(key) ?? null
    }
    finished.push({
      ...shapeStudent(s),
      finishedGroup: {
        id: cs.id,
        label: `${cs.className} ${cs.sectionName}`.trim(),
        course: cs.level?.subject ? { id: cs.level.subject.id, name: cs.level.subject.name } : null,
        level: cs.level ? { id: cs.level.id, name: cs.level.name } : null,
        cycleNumber: cs.currentCycleNumber,
        completedAt: cs.completedAt?.toISOString() ?? null,
      },
      daysWaiting: daysSince(cs.completedAt),
      next: next
        ? {
            kind: next.kind,
            course: { id: next.level.subject.id, name: next.level.subject.name },
            level: { id: next.level.id, name: next.level.name },
            cycleNumber: next.cycleNumber,
          }
        : null,
      wishes: shapeWishes(s),
    })
  }

  const wishes = students.flatMap((s) =>
    shapeWishes(s).map((w) => ({ ...w, student: shapeStudent(s) }))
  )

  // One waiting list per course / level.
  type Bucket = {
    course: { id: string; name: string }
    level: { id: string; name: string } | null
    wishes: number
    finishedNext: number
    upcomingStudents: number
    upcomingGroups: number
  }
  const buckets = new Map<string, Bucket>()
  const bucket = (course: { id: string; name: string }, level: { id: string; name: string } | null) => {
    const key = `${course.id}:${level?.id ?? '-'}`
    let b = buckets.get(key)
    if (!b) {
      b = { course, level, wishes: 0, finishedNext: 0, upcomingStudents: 0, upcomingGroups: 0 }
      buckets.set(key, b)
    }
    return b
  }
  for (const w of wishes) bucket(w.course, w.level).wishes++
  for (const f of finished) if (f.next) bucket(f.next.course, f.next.level).finishedNext++
  for (const { group, students: list } of upcomingByGroup.values()) {
    if (!group.course) continue
    const b = bucket(group.course, group.level)
    b.upcomingGroups++
    b.upcomingStudents += list.length
  }

  const matchesCourse = (courseId: string | null | undefined) => !opts.subjectId || courseId === opts.subjectId

  return {
    byLevel: [...buckets.values()]
      .filter((b) => matchesCourse(b.course.id))
      .sort((a, b) => a.course.name.localeCompare(b.course.name) || (a.level?.name ?? '').localeCompare(b.level?.name ?? '')),
    upcomingGroups: [...upcomingByGroup.values()].filter((g) => matchesCourse(g.group.course?.id)),
    notInGroup: opts.subjectId ? notInGroup.filter((s) => s.wishes.some((w) => w.course.id === opts.subjectId)) : notInGroup,
    finished: finished.filter((f) => matchesCourse(f.next?.course.id) || matchesCourse(f.finishedGroup.course?.id)),
    wishes: wishes.filter((w) => matchesCourse(w.course.id)),
  }
}
