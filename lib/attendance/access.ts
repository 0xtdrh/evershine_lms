/**
 * Final test 14/11 — ONE place that says who may open / save a group's attendance.
 *
 * - Instructors: their own groups, or the group they cover as an accepted substitute on that day.
 * - Every other staff role: only groups in their places (M0 `canSeeGroup`). J02: the roster, the Excel exports and
 *   the student-card scan used to skip this, so a branch manager could read another branch's attendance.
 * - Saving also stops when the group's month is complete (F12): the 5th session of a 4-session month is refused
 *   until staff move the group to the next month. Corrections of dates already held stay allowed.
 */

import { prisma } from '@/lib/prisma'
import { errorResponse, errors } from '@/lib/api-response'
import { canSeeGroup } from '@/lib/places/server'
import { getTeacherByUserId, teacherCanAccessClassSection, teacherCoversSectionOn } from '@/lib/academic/teacher-scope'
import { sessionsPerCycle } from '@/lib/groups/cycle-rules'
import { resolveCycleStart } from '@/lib/groups/cycle-start'
import { cycleIsFull } from './cycle-full'

type SessionUser = { id: string; role: string; campusId?: string | null }

/** null = allowed; otherwise the refusal to return. */
export async function groupAttendanceAccess(user: SessionUser, classSectionId: string, date?: string | null, academicYearId?: string) {
  if (user.role === 'TEACHER') {
    const teacher = await getTeacherByUserId(user.id)
    if (!teacher) return errors.forbidden()
    if (date && (await teacherCoversSectionOn(teacher.id, classSectionId, date))) return null
    if (!(await teacherCanAccessClassSection(teacher.id, classSectionId, academicYearId))) {
      return errors.forbidden('You are not assigned to this section · الجروب ده مش من جروباتك')
    }
    // F13 (final test 15/11): the group's own instructor whose absence that day was APPROVED does not take the session —
    // the substitute does (or it is cancelled). He could still open and save the attendance and get paid for it.
    const away = date ? await approvedAbsenceMessage(teacher.id, classSectionId, date) : null
    return away ? errorResponse('ABSENT_THAT_DAY', away, 403) : null
  }
  return (await canSeeGroup(user as never, classSectionId)) ? null : errors.forbidden()
}

/** The distinct session dates held in the group's current month (attendance + logged sessions), like sync-progress. */
async function heldDatesThisCycle(classSectionId: string, currentCycleStartDate: Date | null, startDate: Date | null) {
  const cycleStart = await resolveCycleStart(classSectionId, currentCycleStartDate, startDate)
  if (!cycleStart) return []
  const [records, logged] = await Promise.all([
    prisma.enrollmentAttendanceRecord.findMany({ where: { studentEnrollment: { classSectionId }, attendanceDate: { gte: cycleStart } }, select: { attendanceDate: true }, distinct: ['attendanceDate'] }),
    prisma.groupSessionLog.findMany({ where: { classSectionId, status: 'HELD', sessionDate: { gte: cycleStart } }, select: { sessionDate: true } }),
  ])
  return [...new Set([...records.map((r) => r.attendanceDate.toISOString().slice(0, 10)), ...logged.map((l) => l.sessionDate.toISOString().slice(0, 10))])]
}

/** F12: the "EN · AR" reason when `date` would be one session too many for this month (only normal groups; recorded / one-to-one have their own rules). */
export async function cycleFullMessage(classSectionId: string, date: string): Promise<string | null> {
  const g = await prisma.classSection.findUnique({
    where: { id: classSectionId },
    select: { kind: true, status: true, cycleSessions: true, currentCycleStartDate: true, startDate: true, level: { select: { numberOfSessions: true, numberOfMonths: true, pricingType: true } } },
  })
  if (!g || g.kind !== 'GROUP' || g.status !== 'ACTIVE' || !g.level) return null
  const per = sessionsPerCycle(g.level, g.cycleSessions)
  const held = await heldDatesThisCycle(classSectionId, g.currentCycleStartDate, g.startDate)
  if (!cycleIsFull(held, per, date.slice(0, 10))) return null
  return `This month's ${per} sessions are done (${held.length} of ${per}). Staff move the group to the next month first, then attendance opens again · حصص الشهر ده خلصت (${held.length} من ${per}). الإدارة تنقل الجروب للشهر الجاي الأول، وبعدها الحضور يتفتح`
}

export async function cycleFullRefusal(classSectionId: string, date: string) {
  const msg = await cycleFullMessage(classSectionId, date)
  return msg ? errorResponse('CYCLE_FULL', msg, 409) : null
}

/**
 * Owner 14/11: the attendance screen says WHY before anyone fills it (group waiting for its minimum, month complete).
 * Returned with the roster; the screens show the message instead of the students.
 */
export async function attendanceNotice(classSectionId: string, date: string): Promise<{ code: 'GROUP_NOT_READY' | 'CYCLE_FULL'; message: string } | null> {
  const blocked = await (await import('@/lib/groups/start')).attendanceBlock(classSectionId)
  if (blocked) return { code: 'GROUP_NOT_READY', message: blocked }
  const full = await cycleFullMessage(classSectionId, date)
  return full ? { code: 'CYCLE_FULL', message: full } : null
}

/** F13: "EN · AR" when this instructor's absence on `date` (whole day, or this group) was approved; null otherwise. */
export async function approvedAbsenceMessage(teacherId: string, classSectionId: string, date: string): Promise<string | null> {
  const day = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  const absence = await prisma.teacherAbsence.findFirst({
    where: { teacherId, status: 'APPROVED', date: day, OR: [{ scope: 'FULL_DAY' }, { classSectionId }] },
    select: { id: true },
  })
  if (!absence) return null
  const sub = await prisma.substituteAssignment.findFirst({
    where: { classSectionId, date: day, originalTeacherId: teacherId, status: 'CONFIRMED' },
    select: { substituteTeacher: { select: { firstName: true, lastName: true } } },
  })
  const d = date.slice(0, 10)
  if (sub) {
    const name = `${sub.substituteTeacher.firstName} ${sub.substituteTeacher.lastName}`.trim()
    return `Your absence on ${d} was approved: ${name} takes this session and records its attendance · غيابك يوم ${d} اتوافق عليه: ${name} هو اللي بيدي الحصة دي ويسجّل حضورها`
  }
  return `Your absence on ${d} was approved, so you cannot record this session. Ask the office if you did teach it · غيابك يوم ${d} اتوافق عليه، فمينفعش تسجّل الحصة دي. لو انت اللي اديتها فعلًا كلّم الإدارة`
}

