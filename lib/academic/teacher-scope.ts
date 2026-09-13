import { prisma } from '@/lib/prisma'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { getTeacherAssignedSectionIds } from '@/lib/academic/teacher-assignments'

export async function getTeacherByUserId(userId: string) {
  return prisma.teacher.findUnique({
    where: { userId },
    select: { id: true, campusId: true, isActive: true },
  })
}

/**
 * Resolve the teacher's current section scope: sections they're formally
 * assigned to (TeacherSectionAssignment) merged with sections where they
 * teach a course directly (SubjectOffering.teacherId). Historical/legacy
 * class and timetable rows are intentionally not authorization sources.
 */
export async function getTeacherClassSectionIds(
  teacherId: string,
  academicYearId?: string,
): Promise<string[]> {
  const year = academicYearId
    ? await prisma.academicYear.findUnique({
        where: { id: academicYearId },
        select: { id: true },
      })
    : await getActiveAcademicYear()

  if (!year) return []

  // WHY merge two sources: a TeacherSectionAssignment is the formal "class
  // teacher / access to this group" grant. A SubjectOffering.teacherId means
  // "this teacher teaches a specific course in this group" — assigned from
  // the Academic Engine's Offerings tab. Historically only the former
  // granted access, which meant a teacher assigned to teach a course still
  // couldn't see their own students' roster, mark attendance, or enter
  // grades until someone separately did the formal assignment too. Since
  // that second step is easy to forget and the failure mode (silently empty
  // lists, no error) is confusing, a direct course assignment now grants the
  // same access on its own.
  const [assignedIds, offerings] = await Promise.all([
    getTeacherAssignedSectionIds(teacherId, year.id),
    prisma.subjectOffering.findMany({
      where: { teacherId, academicYearId: year.id },
      select: { classSectionId: true },
    }),
  ])

  return Array.from(new Set([...assignedIds, ...offerings.map((o) => o.classSectionId)]))
}

export async function teacherCanAccessClassSection(
  teacherId: string,
  classSectionId: string,
  academicYearId?: string,
): Promise<boolean> {
  const allowed = await getTeacherClassSectionIds(teacherId, academicYearId)
  return allowed.includes(classSectionId)
}
