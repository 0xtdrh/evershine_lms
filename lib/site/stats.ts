/** x01: live numbers for the public website (counted from the system; null when the database cannot be read). Server only. */

import { prisma } from '@/lib/prisma'
import type { SiteStats } from './stats-shared'

export async function siteStats(): Promise<SiteStats | null> {
  try {
    const [row] = await prisma.$queryRaw<{ students: bigint; sessions: bigint }[]>`
      SELECT COUNT(DISTINCT e.studentId) AS students, COUNT(DISTINCT e.classSectionId, r.attendanceDate) AS sessions
      FROM EnrollmentAttendanceRecord r JOIN StudentEnrollment e ON e.id = r.studentEnrollmentId`
    const [certificates, partnerPlaces, branches] = await Promise.all([
      prisma.certificate.count({ where: { status: 'VALID' } }),
      prisma.campus.count({ where: { isActive: true, kind: 'PARTNER' } }),
      prisma.campus.count({ where: { isActive: true, kind: 'MAIN' } }),
    ])
    return { students: Number(row?.students ?? 0), sessions: Number(row?.sessions ?? 0), certificates, partnerPlaces, branches }
  } catch (e) {
    console.error('site stats failed', e)
    return null
  }
}
