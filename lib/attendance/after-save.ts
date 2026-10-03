/**
 * Phase C: what happens after attendance is saved (docs/design-phase-c.md).
 *  - parents are told when their child is ABSENT or LATE (only when the
 *    status changed, so saving the sheet twice does not notify twice)
 *  - a student absent two sessions in a row → branch staff alert + a follow-up
 *    in the contact log for today
 * Never throws.
 * Server-only.
 */

import { prisma } from '@/lib/prisma'
import { notifyFamilies, notifyUsers, branchStaffUserIds } from '@/lib/notifications/events'
import { logSystemContact } from '@/lib/contacts/contact-log'
import { excusesOn } from '@/lib/excuses/engine'

type Status = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED'

/** ABSENT → EXCUSED for students with an approved excuse for that session. */
export async function applyExcuses<T extends { studentEnrollmentId: string; status: Status; remarks?: string }>(classSectionId: string, date: string, records: T[]): Promise<T[]> {
  try {
    const absent = records.filter((r) => r.status === 'ABSENT')
    if (!absent.length) return records
    const excuses = await excusesOn(classSectionId, new Date(`${date.slice(0, 10)}T00:00:00.000Z`))
    if (!excuses.size) return records
    const enr = await prisma.studentEnrollment.findMany({ where: { id: { in: absent.map((r) => r.studentEnrollmentId) } }, select: { id: true, studentId: true } })
    const studentOf = new Map(enr.map((e) => [e.id, e.studentId]))
    return records.map((r) => {
      const x = r.status === 'ABSENT' ? excuses.get(studentOf.get(r.studentEnrollmentId) ?? '') : undefined
      return x?.status === 'APPROVED' ? { ...r, status: 'EXCUSED' as Status, remarks: r.remarks || `Excuse: ${x.reason}`.slice(0, 190) } : r
    })
  } catch (err) {
    console.error('[ATTENDANCE_APPLY_EXCUSES]', err)
    return records
  }
}

export async function afterAttendanceSaved(input: {
  classSectionId: string
  date: string
  before: Map<string, string>
  after: { studentEnrollmentId: string; status: string }[]
}) {
  try {
    const changed = input.after.filter((r) => (r.status === 'ABSENT' || r.status === 'LATE') && input.before.get(r.studentEnrollmentId) !== r.status)
    if (!changed.length) return
    const group = await prisma.classSection.findUnique({ where: { id: input.classSectionId }, select: { className: true, sectionName: true, campusId: true } })
    const label = `${group?.className ?? ''} ${group?.sectionName ?? ''}`.trim()
    const enr = await prisma.studentEnrollment.findMany({ where: { id: { in: changed.map((r) => r.studentEnrollmentId) } }, select: { id: true, studentId: true } })
    const studentOf = new Map(enr.map((e) => [e.id, e.studentId]))
    const day = input.date.slice(0, 10)
    const absentIds = changed.filter((r) => r.status === 'ABSENT').map((r) => studentOf.get(r.studentEnrollmentId)!).filter(Boolean)
    const lateIds = changed.filter((r) => r.status === 'LATE').map((r) => studentOf.get(r.studentEnrollmentId)!).filter(Boolean)

    await notifyFamilies(absentIds, 'ATTENDANCE_ABSENT', (s) => ({
      title: 'Absent today',
      message: `${s.firstName} was absent from the ${label} session on ${day}. If there was a reason, you can send an excuse from the portal.`,
      relatedId: input.classSectionId,
    }))
    await notifyFamilies(lateIds, 'ATTENDANCE_LATE', (s) => ({
      title: 'Arrived late',
      message: `${s.firstName} arrived late to the ${label} session on ${day}.`,
      relatedId: input.classSectionId,
    }))

    // Two absences in a row (exactly the second one, so the alert is sent once per streak).
    const until = new Date(`${day}T00:00:00.000Z`)
    for (const studentId of absentIds) {
      const last = await prisma.enrollmentAttendanceRecord.findMany({
        where: { studentEnrollment: { studentId }, attendanceDate: { lte: until } },
        orderBy: { attendanceDate: 'desc' },
        take: 3,
        select: { status: true },
      })
      if (last.length < 2 || last[0].status !== 'ABSENT' || last[1].status !== 'ABSENT' || last[2]?.status === 'ABSENT') continue
      const s = await prisma.student.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true, campusId: true, guardians: { select: { id: true } } } })
      if (!s) continue
      await notifyUsers(await branchStaffUserIds(s.campusId), 'CONSECUTIVE_ABSENCE', {
        title: 'Absent twice in a row',
        message: `${s.firstName} ${s.lastName} (${label}) missed two sessions in a row. A follow-up was added for today.`,
        relatedId: studentId,
      })
      await logSystemContact({
        studentId,
        guardianId: s.guardians[0]?.id ?? null,
        channel: 'SYSTEM',
        reason: 'ABSENCE',
        summary: `Absent two sessions in a row (last: ${label}, ${day}). Please call the parent.`,
        followUpAt: new Date(),
      })
    }
  } catch (err) {
    console.error('[ATTENDANCE_AFTER_SAVE]', err)
  }
}
