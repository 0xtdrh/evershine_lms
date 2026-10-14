/**
 * GET /api/exports/teachers
 * Returns ALL teachers (no pagination) for Excel export.
 * Includes credentials/user status, employee code, designation, qualification, salary details, and class assignments.
 *
 * RBAC: SUPER_ADMIN, ADMIN only.
 */

import { narrow, teacherWhere } from '@/lib/places/rules'
import { requestPlaces } from '@/lib/places/server'
import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkPermission } from '@/lib/rbac'
import { errors, successResponse } from '@/lib/api-response'
import type { Role } from '@prisma/client'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return errors.unauthorized()

  const role = session.user.role as Role
  if (!checkPermission(role, 'teachers', 'read')) return errors.forbidden()

  // M0: the person's places (the place filter can only narrow)
  const places = narrow(await requestPlaces(session.user), new URL(request.url).searchParams.get('campusId'))

  const teachers = await prisma.teacher.findMany({
    where: {
      ...teacherWhere(places),
    },
    orderBy: [
      { campus: { name: 'asc' } },
      { employeeId: 'asc' },
    ],
    select: {
      employeeId: true,
      firstName: true,
      lastName: true,
      designation: true,
      specialization: true,
      qualification: true,
      experienceYears: true,
      joiningDate: true,
      monthlySalary: true,
      isActive: true,
      campus: { select: { name: true, code: true } },
      classes: {
        select: {
          class: { select: { name: true } },
        },
      },
      subjects: {
        select: {
          subject: { select: { name: true } },
        },
      },
    },
  })

  // Format response for the Excel builder
  const formattedTeachers = teachers.map(t => ({
    employeeId: t.employeeId,
    firstName: t.firstName,
    lastName: t.lastName,
    designation: t.designation,
    specialization: t.specialization || 'N/A',
    qualification: t.qualification,
    experience: `${t.experienceYears} Years`,
    joiningDate: t.joiningDate,
    salary: t.monthlySalary ? Number(t.monthlySalary) : 0,
    isActive: t.isActive,
    campus: t.campus,
    classTeachers: t.classes,
    subjectTeachers: t.subjects,
  }))

  return successResponse(formattedTeachers)
}
