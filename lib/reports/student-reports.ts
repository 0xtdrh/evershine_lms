/**
 * Phase C reports (docs/design-phase-c.md), built automatically from data we
 * already have — no extra work for instructors:
 *  - MONTHLY report per finished group (= month): attendance session by session,
 *    perfect attendance, the student's session ratings, the result if any.
 *    Skipped when the level is only one month long (the level report covers it).
 *  - LEVEL report when the level's result is in: attendance of every month of
 *    the level, result + instructor feedback, certificate, recommendation.
 * Session reports, homework, quizzes and skills come with Moodle (phase C2):
 * the `moodle` field is the slot for that data.
 * Server-only.
 */

import { prisma } from '@/lib/prisma'
import { sessionsPerCycle, cyclesInLevel } from '@/lib/groups/cycle-rules'
import { studentAttendanceTimeline, type GroupAttendance } from '@/lib/attendance/timeline'
import { attendanceStats } from '@/lib/attendance/timeline-calc'

export interface ReportEntry { kind: 'MONTHLY' | 'LEVEL'; classSectionId: string; title: string; subtitle: string; date: string | null }

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)

/** Reports available for a student, newest first. */
export async function listReports(studentId: string): Promise<ReportEntry[]> {
  const { groups } = await studentAttendanceTimeline(studentId, { limit: 60 })
  const out: ReportEntry[] = []
  for (const g of groups) {
    if (g.finished && g.cyclesInLevel > 1 && g.sessions.length) {
      out.push({ kind: 'MONTHLY', classSectionId: g.classSectionId, title: `${g.course ?? g.group} · ${g.level ?? ''} — month ${g.cycleNumber}`, subtitle: g.group, date: g.sessions[g.sessions.length - 1]?.date ?? null })
    }
  }
  const results = await prisma.studentLevelResult.findMany({
    where: { passed: { not: null }, studentEnrollment: { studentId } },
    select: {
      updatedAt: true,
      studentEnrollment: { select: { classSectionId: true, classSection: { select: { className: true, sectionName: true, currentCycleNumber: true, level: { select: { name: true, numberOfMonths: true, numberOfSessions: true, pricingType: true, subject: { select: { name: true } } } } } } } },
    },
    orderBy: { updatedAt: 'desc' },
  })
  for (const r of results) {
    const cs = r.studentEnrollment.classSection
    if (!cs.level || cs.currentCycleNumber < cyclesInLevel(cs.level)) continue // a mid-level result is shown in the monthly report
    out.push({ kind: 'LEVEL', classSectionId: r.studentEnrollment.classSectionId, title: `${cs.level.subject?.name ?? ''} · ${cs.level.name} — level report`, subtitle: `${cs.className} ${cs.sectionName}`.trim(), date: r.updatedAt.toISOString().slice(0, 10) })
  }
  return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

async function studentHeader(studentId: string) {
  const s = await prisma.student.findUnique({
    where: { id: studentId },
    select: { firstName: true, lastName: true, registrationNumber: true, campus: { select: { name: true } } },
  })
  return s ? { name: `${s.firstName} ${s.lastName}`, registrationNumber: s.registrationNumber, campus: s.campus?.name ?? '' } : null
}

async function resultFor(studentId: string, classSectionId: string) {
  const r = await prisma.studentLevelResult.findFirst({
    where: { studentEnrollment: { studentId, classSectionId } },
    select: { id: true, homeworkScore: true, taskScore: true, instructorScore: true, projectScore: true, mcqScore: true, finalScore: true, passed: true, instructorFeedback: true, homeworkSource: true },
  })
  if (!r) return null
  const cert = await prisma.certificate.findUnique({ where: { levelResultId: r.id }, select: { certificateNumber: true, isRevealed: true } })
  return { ...r, certificate: cert?.isRevealed ? cert.certificateNumber : null }
}

async function faces(studentId: string, groupIds: string[]) {
  const rows = await prisma.sessionFeedback.findMany({ where: { studentId, classSectionId: { in: groupIds } }, select: { rating: true } })
  return { average: avg(rows.map((r) => r.rating)), count: rows.length, outOf: 4 }
}

export async function monthlyReport(studentId: string, classSectionId: string) {
  const [student, timeline] = await Promise.all([studentHeader(studentId), studentAttendanceTimeline(studentId, { groupIds: [classSectionId] })])
  const g = timeline.groups[0]
  if (!student || !g) return null
  return {
    kind: 'MONTHLY' as const,
    student,
    group: summaryOf(g),
    sessions: g.sessions,
    stats: g.stats,
    perfect: g.perfect,
    sessionRatings: await faces(studentId, [classSectionId]),
    result: await resultFor(studentId, classSectionId),
    moodle: null,
  }
}

const summaryOf = (g: GroupAttendance) => ({ id: g.classSectionId, label: g.group, course: g.course, level: g.level, cycleNumber: g.cycleNumber, cyclesInLevel: g.cyclesInLevel, finished: g.finished })

export async function levelReport(studentId: string, classSectionId: string) {
  const group = await prisma.classSection.findUnique({
    where: { id: classSectionId },
    select: { levelId: true, level: { select: { id: true, name: true, order: true, subjectId: true, numberOfSessions: true, numberOfMonths: true, pricingType: true, subject: { select: { name: true } } } } },
  })
  if (!group?.level) return null
  const level = group.level
  const levelGroups = (await prisma.studentEnrollment.findMany({ where: { studentId, classSection: { levelId: level.id } }, select: { classSectionId: true } })).map((e) => e.classSectionId)
  const [student, timeline, result, next] = await Promise.all([
    studentHeader(studentId),
    studentAttendanceTimeline(studentId, { groupIds: levelGroups }),
    resultFor(studentId, classSectionId),
    prisma.level.findFirst({ where: { subjectId: level.subjectId, order: { gt: level.order } }, orderBy: { order: 'asc' }, select: { name: true } }),
  ])
  if (!student) return null
  const months = [...timeline.groups].sort((a, b) => a.cycleNumber - b.cycleNumber)
  const all = attendanceStats(months.flatMap((m) => m.sessions.map((s) => s.status)))
  const passed = result?.passed
  return {
    kind: 'LEVEL' as const,
    student,
    course: level.subject?.name ?? null,
    level: level.name,
    sessionsInLevel: level.numberOfSessions,
    perMonth: sessionsPerCycle(level),
    months: months.map((m) => ({ ...summaryOf(m), stats: m.stats, perfect: m.perfect, sessions: m.sessions })),
    stats: all,
    sessionRatings: await faces(studentId, levelGroups),
    result,
    recommendation: passed == null ? null : passed
      ? { action: 'NEXT_LEVEL' as const, text: next ? `Ready for ${next.name}.` : 'Level completed — ready for the next course.' }
      : { action: 'REPEAT' as const, text: `We recommend repeating ${level.name} to strengthen the basics.` },
    skills: null,
    moodle: null,
  }
}
