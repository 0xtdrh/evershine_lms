import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errors, successResponse } from '@/lib/api-response'
import { requireSession, requirePermission } from '@/lib/academic/api-helpers'
import { getActiveAcademicYear } from '@/lib/academic/engine'
import { attendanceNotice, groupAttendanceAccess } from '@/lib/attendance/access'
import { getOrSyncSectionEnrollments } from '@/lib/academic/roster-helper'
import type { Role } from '@prisma/client'
import { excusesOn } from '@/lib/excuses/engine'
import { onlineJoinsOn } from '@/lib/online/engine'
import { sessionModeOn, studentModesOn } from '@/lib/delivery/session-modes'
import { cairoToday } from '@/lib/dates/cairo'

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
  const dateStr = params.get('date') ?? cairoToday()
  
  if (!classSectionId) {
    return errors.validation({
      errors: [{ path: ['classSectionId'], message: 'classSectionId is required' }],
    } as never)
  }
  const attendanceDate = new Date(dateStr)

  const activeYear = await getActiveAcademicYear()
  if (!activeYear) return successResponse({ enrollments: [], date: dateStr, stats: { total: 0, present: 0, absent: 0 } })

  // J02 (final test): staff only their places, instructors their groups / the day they cover (lib/attendance/access.ts)
  const noAccess = await groupAttendanceAccess(session.user, classSectionId, dateStr, activeYear?.id)
  if (noAccess) return noAccess

  const { targetClassSectionId, enrollments: rawEnrollments } = await getOrSyncSectionEnrollments(
    classSectionId,
    activeYear?.id,
    { batchId: batchId || undefined, shiftId: shiftId || undefined }
  )

  // Historical completeness: a student withdrawn/excluded since this date
  // shouldn't vanish from a PAST session they actually attended. Pull in
  // any withdrawn enrollment in this section that already has a record for
  // this exact date, tagged so the UI can show them as no-longer-active.
  const withdrawnWithRecord = await prisma.studentEnrollment.findMany({
    where: {
      classSectionId,
      status: 'WITHDRAWN',
      attendanceRecords: { some: { attendanceDate } },
    },
    include: {
      student: { select: { firstName: true, lastName: true, rollNumber: true } },
      classSection: { select: { batch: { select: { id: true, name: true } }, shift: { select: { id: true, name: true } } } },
    },
  })

  // Attach attendance records for attendanceDate
  const enrollmentIds = [...rawEnrollments.map((e) => e.id), ...withdrawnWithRecord.map((e) => e.id)]
  const attendanceRecords = await prisma.enrollmentAttendanceRecord.findMany({
    where: {
      studentEnrollmentId: { in: enrollmentIds },
      attendanceDate,
    },
  })

  const enrollments = [
    ...rawEnrollments.map((e) => ({ ...e, isWithdrawn: false })),
    ...withdrawnWithRecord.map((e) => ({ ...e, isWithdrawn: true })),
  ].map((e) => {
    const rec = attendanceRecords.find((r) => r.studentEnrollmentId === e.id)
    return {
      ...e,
      attendanceRecords: rec ? [rec] : [],
    }
  })

  // Phase C: parents' excuses for this session (shown next to the name; approved = EXCUSED by default)
  const excuses = await excusesOn(classSectionId, attendanceDate)
  // L5: who pressed Join for the online session (provisional attendance)
  const joins = await onlineJoinsOn(classSectionId, dateStr)
  // a02: how this session is held, and students attending it another way (e.g. online while travelling)
  const [sessionMode, studentModes] = await Promise.all([sessionModeOn(classSectionId, dateStr), studentModesOn(classSectionId, dateStr)])
  // 2-B: how much of the recorded session each student attending it RECORDED has watched
  const recordedIds = enrollments.filter((e) => (studentModes.get(e.studentId) ?? sessionMode) === 'RECORDED').map((e) => e.studentId)
  const watched = await (await import('@/lib/attendance/recorded-watch')).recordedWatchOn(classSectionId, dateStr, recordedIds)

  // Calculate attendance statistics for this session
  let present = 0
  let absent = 0
  enrollments.forEach((e) => {
    const status = Array.isArray(e.attendanceRecords) ? e.attendanceRecords[0]?.status : null
    if (status === 'PRESENT') present++
    if (status === 'ABSENT') absent++
  })

  // owner 14/11: tell the screen up front when attendance cannot be taken on this date (minimum / month complete)
  const notice = await attendanceNotice(classSectionId, dateStr).catch(() => null)

  return successResponse({
    academicYear: activeYear,
    classSectionId,
    notice,
    date: dateStr,
    sessionMode,
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
      // a02 batch 5: detail beside the status (PARTIAL / CAMERA_OFF / WATCHED) and online minutes, as saved
      todayDetail: Array.isArray(e.attendanceRecords) ? (e.attendanceRecords[0] as { presenceDetail?: string | null } | undefined)?.presenceDetail ?? null : null,
      todayMinutes: Array.isArray(e.attendanceRecords) ? (e.attendanceRecords[0] as { minutes?: number | null } | undefined)?.minutes ?? null : null,
      isWithdrawn: e.isWithdrawn,
      excuse: excuses.get(e.studentId) ? { status: excuses.get(e.studentId)!.status, reason: excuses.get(e.studentId)!.reason, kind: excuses.get(e.studentId)!.kind ?? null } : null,
      onlineJoinedAt: joins.get(e.studentId) ?? null,
      attendsAs: studentModes.get(e.studentId) ?? null,
      recordedWatchPercent: watched.get(e.studentId) ?? null,
    })),
  })
}
