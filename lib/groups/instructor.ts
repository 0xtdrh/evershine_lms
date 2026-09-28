/**
 * The ONE rule for "who is this group's instructor".
 *
 * A group can end up with several SubjectOffering rows (old academic years,
 * offerings created from the Academic Engine or the old timetable). Different
 * screens used to pick different rows (newest of any kind, newest with a
 * teacher, ...), so an instructor saved on one row could show as missing on
 * another screen.
 *
 * Rule:
 *  1. The offering for the group's CURRENT course (level.subjectId) in the
 *     ACTIVE academic year — exactly the row POST /api/groups/[id]/instructor
 *     writes. If it exists, it is the answer (teacherId null = unassigned).
 *  2. Otherwise the newest offering that has a teacher.
 */

import { prisma } from '@/lib/prisma'

export interface OfferingLike {
  subjectId: string
  academicYearId: string
  teacherId: string | null
  createdAt: Date
}

export function pickGroupInstructorOffering<T extends OfferingLike>(
  offerings: T[],
  levelSubjectId: string | null | undefined,
  activeYearId: string | null | undefined
): T | null {
  if (levelSubjectId && activeYearId) {
    const current = offerings.find((o) => o.subjectId === levelSubjectId && o.academicYearId === activeYearId)
    if (current) return current
  }
  return (
    offerings
      .filter((o) => o.teacherId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
  )
}

/**
 * Loads a group's offerings and applies the rule above. Returns the full
 * SubjectOffering row (with pay overrides), or null.
 */
export async function findGroupInstructorOffering(classSectionId: string, activeYearId: string | null | undefined) {
  const group = await prisma.classSection.findUnique({
    where: { id: classSectionId },
    select: {
      level: { select: { subjectId: true } },
      subjectOfferings: { include: { teacher: { select: { firstName: true, lastName: true } } } },
    },
  })
  if (!group) return null
  return pickGroupInstructorOffering(group.subjectOfferings, group.level?.subjectId, activeYearId)
}
