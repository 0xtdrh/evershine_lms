/**
 * Phase C: who may see one student's attendance / reports / birthday card:
 * staff with students:read (in their branch), the student's parents, the student.
 * Server-only.
 */

import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { campusScope } from '@/lib/academic/api-helpers'
import { assertGuardianAccessToStudent } from '@/lib/academic/guardian'
import { getTeacherByUserId, getTeacherClassSectionIds } from '@/lib/academic/teacher-scope'
import type { Role } from '@prisma/client'

export type Viewer = 'STAFF' | 'TEACHER' | 'PARENT' | 'STUDENT'

export async function studentViewer(user: { id: string; role: string; campusId?: string | null }, studentId: string): Promise<Viewer | null> {
  const role = user.role as Role
  if (role === 'PARENT' || role === 'GUARDIAN') return (await assertGuardianAccessToStudent(user.id, studentId)) ? 'PARENT' : null
  if (role === 'STUDENT') {
    const s = await prisma.student.findFirst({ where: { userId: user.id }, select: { id: true } })
    return s?.id === studentId ? 'STUDENT' : null
  }
  if (role === 'TEACHER') {
    const t = await getTeacherByUserId(user.id)
    if (!t) return null
    const groups = await getTeacherClassSectionIds(t.id)
    const n = await prisma.studentEnrollment.count({ where: { studentId, classSectionId: { in: groups } } })
    return n ? 'TEACHER' : null
  }
  if (!checkPermission(role, 'students', 'read')) return null
  const scoped = campusScope(role, user.campusId, null)
  if (scoped) {
    const s = await prisma.student.findUnique({ where: { id: studentId }, select: { campusId: true } })
    if (s?.campusId !== scoped) return null
  }
  return 'STAFF'
}
