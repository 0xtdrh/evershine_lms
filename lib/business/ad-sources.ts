/**
 * x01 / business growth: for one Cairo month — what was spent per source (typed by the manager), the website visits and
 * requests per source, and the new students those requests became (a student's or guardian's phone matches a website
 * request sent before the first session). Company-wide only. Server only.
 */

import { prisma } from '@/lib/prisma'
import { SOURCES } from '@/lib/site/visit-rules'
import { adSources, firstSourcePerStudent } from './ad-calc'

const tally = (rows: { source: string; n: bigint | number }[]) => Object.fromEntries(rows.map((r) => [r.source, Number(r.n)]))

export async function adSourcesFor(ym: string) {
  const [spendRows, visits, requests, newRows, matches] = await Promise.all([
    prisma.marketingSpend.findMany({ where: { ym } }),
    prisma.$queryRaw<{ source: string; n: bigint }[]>`
      SELECT source, COUNT(*) AS n FROM SiteVisit WHERE DATE_FORMAT(CONVERT_TZ(startedAt, '+00:00', '+02:00'), '%Y-%m') = ${ym} GROUP BY source`,
    prisma.$queryRaw<{ source: string; n: bigint }[]>`
      SELECT v.source AS source, COUNT(*) AS n FROM LandingInquiry li JOIN SiteVisit v ON v.sessionId = li.visitSessionId
      WHERE DATE_FORMAT(CONVERT_TZ(li.createdAt, '+00:00', '+02:00'), '%Y-%m') = ${ym} GROUP BY v.source`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM (SELECT e.studentId, MIN(r.attendanceDate) AS f FROM EnrollmentAttendanceRecord r
        JOIN StudentEnrollment e ON e.id = r.studentEnrollmentId GROUP BY e.studentId) t WHERE DATE_FORMAT(t.f, '%Y-%m') = ${ym}`,
    prisma.$queryRaw<{ studentId: string; source: string; at: Date }[]>`
      SELECT f.studentId AS studentId, v.source AS source, li.createdAt AS at
      FROM (SELECT e.studentId, MIN(r.attendanceDate) AS f FROM EnrollmentAttendanceRecord r
            JOIN StudentEnrollment e ON e.id = r.studentEnrollmentId GROUP BY e.studentId HAVING DATE_FORMAT(MIN(r.attendanceDate), '%Y-%m') = ${ym}) f
      JOIN Student s ON s.id = f.studentId
      LEFT JOIN _GuardianToStudent gs ON gs.B = s.id
      LEFT JOIN Guardian g ON g.id = gs.A
      JOIN LandingInquiry li ON li.visitSessionId IS NOT NULL AND li.createdAt <= f.f + INTERVAL 1 DAY
        AND li.phone IN (s.phoneNumber, IFNULL(s.fatherPhoneNumber, '-'), IFNULL(s.motherPhoneNumber, '-'), IFNULL(g.phoneNumber, '-'))
      JOIN SiteVisit v ON v.sessionId = li.visitSessionId`,
  ])
  return {
    ym,
    ...adSources({
      spend: Object.fromEntries(spendRows.map((r) => [r.source, r.amount])),
      visits: tally(visits), requests: tally(requests),
      studentSource: firstSourcePerStudent(matches), newStudentsTotal: Number(newRows[0]?.n ?? 0),
    }),
  }
}

/** The manager types what was spent per source in a month (0 / empty removes it). */
export async function saveSpend(userId: string, ym: string, values: Record<string, number | null>) {
  for (const source of SOURCES) {
    if (!(source in values)) continue
    const v = values[source]
    if (!v) await prisma.marketingSpend.deleteMany({ where: { ym, source } })
    else await prisma.marketingSpend.upsert({ where: { ym_source: { ym, source } }, create: { ym, source, amount: v, updatedById: userId }, update: { amount: v, updatedById: userId } })
  }
}
