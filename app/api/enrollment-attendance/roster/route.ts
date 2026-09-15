import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { getTeacherByUserId, teacherCanAccessClassSection } from '@/lib/academic/teacher-scope'
import { getOrSyncSectionEnrollments } from '@/lib/academic/roster-helper'
import type { Role } from '@prisma/client'

/** Active enrollments in a class section for attendance marking with batch/shift filters. */
export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const denied = requirePermission(session.user.role as Role, 'attendance', 'read')
  if (denied) return denied

  const params = new URL(request.url).searchParams
  const classSectionId = params.get('classSectionId')
  const batchId = params.get('batchId')
  const shiftId = params.get('shiftId')
  const dateStr = params.get('date') ?? new Date().toISOString().split('T')[0]
  
  if (!classSectionId) {
    return errors.validation({
      errors: [{ path: ['classSectionId'], message: 'classSectionId is required' }],
    } as never)
  }
  const attendanceDate = new Date(dateStr)

  const activeYear = await getActiveAcademicYear()
  if (!activeYear) return successResponse({ enrollments: [], date: dateStr, stats: { total: 0, present: 0, absent: 0 } })

  if (session.user.role === 'TEACHER') {
    const teacher = await getTeacherByUserId(session.user.id)
    if (!teacher) return errors.forbidden()

    const allowed = await teacherCanAccessClassSection(teacher.id, classSectionId, activeYear?.id)
    if (!allowed) {
      return errors.forbidden('You are not assigned to this section')
    }
  }

  const { targetClassSectionId, enrollments: rawEnrollments } = await getOrSyncSectionEnrollments(
    classSectionId,
    activeYear?.id,
    { batchId: batchId || undefined, shiftId: shiftId || undefined }
  )

  // Attach attendance records for attendanceDate
  const enrollmentIds = rawEnrollments.map((e) => e.id)
  const attendanceRecords = await prisma.enrollmentAttendanceRecord.findMany({
    where: {
      studentEnrollmentId: { in: enrollmentIds },
      attendanceDate,
    },
  })

  const enrollments = rawEnrollments.map((e) => {
    const rec = attendanceRecords.find((r) => r.studentEnrollmentId === e.id)
    return {
      ...e,
      attendanceRecords: rec ? [rec] : [],
    }
  })

  // Calculate attendance statistics for this session
  let present = 0
  let absent = 0
  enrollments.forEach((e) => {
    const status = Array.isArray(e.attendanceRecords) ? e.attendanceRecords[0]?.status : null
    if (status === 'PRESENT') present++
    if (status === 'ABSENT') absent++
  })

  return successResponse({
    academicYear: activeYear,
    classSectionId,
    date: dateStr,
    filters: { batchId, shiftId },
    stats: {
      total: enrollments.length,
      present,
      absent,
    },
    enrollments: enrollments.map((e) => ({
      studentEnrollmentId: e.id,
      rollNumber: e.rollNumber,
      student: e.student,
      batch: e.classSection.batch,
      shift: e.classSection.shift,
      todayStatus: Array.isArray(e.attendanceRecords) ? e.attendanceRecords[0]?.status : null,
    })),
  })
}
