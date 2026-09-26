import { prisma } from '@/lib/prisma'

/**
 * A group created via /advance-cycle starts with no startDate/
 * currentCycleStartDate on purpose — its "real" start is whenever the first
 * attendance session actually happens, not the moment the group record was
 * created (there can be a gap of days between the two). Until that first
 * session exists, this returns null (meaning: no sessions to count yet).
 */
export async function resolveCycleStart(
  classSectionId: string,
  currentCycleStartDate: Date | null,
  startDate: Date | null
): Promise<Date | null> {
  if (currentCycleStartDate) return currentCycleStartDate
  if (startDate) return startDate

  const earliest = await prisma.enrollmentAttendanceRecord.findFirst({
    where: { studentEnrollment: { classSectionId } },
    orderBy: { attendanceDate: 'asc' },
    select: { attendanceDate: true },
  })
  return earliest?.attendanceDate ?? null
}
