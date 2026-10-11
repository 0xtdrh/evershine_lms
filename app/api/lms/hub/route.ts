/**
 * LMS hub numbers for staff: homework hand-ins waiting to be graded and quiz tries waiting for review in the groups
 * this person runs; curriculum versions waiting for approval (approvers only).
 */

import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession } from '@/lib/academic/api-helpers'
import { checkPermission } from '@/lib/rbac'
import { getTeacherByUserId, getTeacherClassSectionIds } from '@/lib/academic/teacher-scope'
import { getPerformanceSettings } from '@/lib/teachers/performance'

export async function GET() {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  if (!checkPermission(role, 'curriculum', 'read')) return errors.forbidden()
  let groupIds: string[] | null = null // null = every group
  if (role === 'BRANCH_MANAGER' && session.user.campusId) groupIds = (await prisma.classSection.findMany({ where: { campusId: session.user.campusId }, select: { id: true } })).map((g) => g.id)
  else if (role === 'TEACHER') {
    const t = await getTeacherByUserId(session.user.id)
    const subs = t ? (await prisma.substituteAssignment.findMany({ where: { substituteTeacherId: t.id, status: 'CONFIRMED' }, select: { classSectionId: true } })).map((s) => s.classSectionId) : []
    groupIds = t ? [...new Set([...(await getTeacherClassSectionIds(t.id)), ...subs])] : []
  } else if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') groupIds = []
  const inGroups = groupIds === null ? {} : { classSectionId: { in: groupIds } }
  const [toGrade, quizReview, inReview] = await Promise.all([
    prisma.assignmentSubmission.count({ where: { ...inGroups, status: 'SUBMITTED' } }),
    prisma.quizAttempt.count({ where: { ...inGroups, status: 'SUBMITTED' } }),
    checkPermission(role, 'curriculum', 'approve') ? prisma.curriculumEdition.count({ where: { status: 'IN_REVIEW' } }) : Promise.resolve(0),
  ])
  const myPerformance = role === 'TEACHER' && (await getPerformanceSettings()).teacherCanSee
  return successResponse({ toGrade, quizReview, inReview, myPerformance })
}
