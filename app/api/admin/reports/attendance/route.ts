/**
 * GET /api/admin/reports/attendance
 * Real attendance-rate report for the active academic year, built from
 * EnrollmentAttendanceRecord (the Group/Course system actually in use) —
 * not the legacy Class-based Attendance model, and with no fabricated
 * fallback numbers. An empty result means no attendance has been marked
 * yet, and is returned as empty, not invented.
 *
 * Also computes a real "at risk" flag: a student's current run of
 * consecutive ABSENT days (most recent marked days first, stopping at the
 * first non-ABSENT day) at or above CONSECUTIVE_ABSENCE_THRESHOLD. An
 * EXCUSED day breaks the streak on purpose — it is not an unexcused absence.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { successResponse } from '@/lib/api-response'
import { requireSession, requirePermission, campusScope } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import type { Role } from '@prisma/client'

const CONSECUTIVE_ABSENCE_THRESHOLD = 3

export async function GET(request: NextRequest) {
  const { session, error } = await requireSession()
  if (error || !session) return error!
  const role = session.user.role as Role
  const denied = requirePermission(role, 'attendance', 'read')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const requestedCampusId = searchParams.get('campusId')
  const campusId = campusScope(role, session.user.campusId, requestedCampusId)

  const activeYear = await getActiveAcademicYear()
  if (!activeYear) {
    return successResponse({
      academicYear: null,
      overallRate: null,
      totalRecordsMarked: 0,
      groups: [],
      atRiskStudents: [],
      students: [],
    })
  }

  const enrollments = await prisma.studentEnrollment.findMany({
    where: {
      academicYearId: activeYear.id,
      status: 'ACTIVE',
      ...(campusId && { classSection: { campusId } }),
    },
    select: {
      id: true,
      student: { select: { id: true, firstName: true, lastName: true, registrationNumber: true } },
      classSection: {
        select: {
          id: true,
          className: true,
          sectionName: true,
          campus: { select: { id: true, name: true } },
        },
      },
      // Most recent first — required for the consecutive-absence walk below.
      attendanceRecords: {
        select: { attendanceDate: true, status: true },
        orderBy: { attendanceDate: 'desc' },
      },
    },
  })

  let totalMarked = 0
  let totalPresent = 0

  const groupMap = new Map<
    string,
    {
      classSectionId: string
      label: string
      campusName: string
      totalStudents: number
      totalMarked: number
      present: number
      absent: number
      late: number
      excused: number
    }
  >()

  const students = enrollments.map((e) => {
    const records = e.attendanceRecords
    const total = records.length
    const present = records.filter((r) => r.status === 'PRESENT').length
    const absent = records.filter((r) => r.status === 'ABSENT').length
    const late = records.filter((r) => r.status === 'LATE').length
    const excused = records.filter((r) => r.status === 'EXCUSED').length
    const attendanceRate = total > 0 ? Math.round((present / total) * 1000) / 10 : null

    totalMarked += total
    totalPresent += present

    let consecutiveUnexcusedAbsences = 0
    for (const r of records) {
      if (r.status === 'ABSENT') consecutiveUnexcusedAbsences++
      else break
    }

    const groupLabel = `${e.classSection.className} ${e.classSection.sectionName}`.trim()
    const groupKey = e.classSection.id
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, {
        classSectionId: groupKey,
        label: groupLabel,
        campusName: e.classSection.campus.name,
        totalStudents: 0,
        totalMarked: 0,
        present: 0,
        absent: 0,
        late: 0,
        excused: 0,
      })
    }
    const g = groupMap.get(groupKey)!
    g.totalStudents += 1
    g.totalMarked += total
    g.present += present
    g.absent += absent
    g.late += late
    g.excused += excused

    return {
      studentId: e.student.id,
      studentEnrollmentId: e.id,
      name: `${e.student.firstName} ${e.student.lastName}`,
      registrationNumber: e.student.registrationNumber,
      classSection: groupLabel,
      campusName: e.classSection.campus.name,
      totalMarkedDays: total,
      present,
      absent,
      late,
      excused,
      attendanceRate,
      consecutiveUnexcusedAbsences,
      atRisk: consecutiveUnexcusedAbsences >= CONSECUTIVE_ABSENCE_THRESHOLD,
    }
  })

  const groups = Array.from(groupMap.values()).map((g) => ({
    classSectionId: g.classSectionId,
    label: g.label,
    campusName: g.campusName,
    totalStudents: g.totalStudents,
    totalMarked: g.totalMarked,
    present: g.present,
    absent: g.absent,
    late: g.late,
    excused: g.excused,
    attendanceRate: g.totalMarked > 0 ? Math.round((g.present / g.totalMarked) * 1000) / 10 : null,
  }))

  const atRiskStudents = students
    .filter((s) => s.atRisk)
    .sort((a, b) => b.consecutiveUnexcusedAbsences - a.consecutiveUnexcusedAbsences)

  return successResponse({
    academicYear: { id: activeYear.id, name: activeYear.name },
    consecutiveAbsenceThreshold: CONSECUTIVE_ABSENCE_THRESHOLD,
    overallRate: totalMarked > 0 ? Math.round((totalPresent / totalMarked) * 1000) / 10 : null,
    totalRecordsMarked: totalMarked,
    groups,
    atRiskStudents,
    students,
  })
}
