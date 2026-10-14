/**
 * LMS analytics for staff (owner 2026-10-11): numbers of a period, groups table, students who need follow-up,
 * hardest quiz questions and weekly activity. Read-only. Scope: admins every group, branch manager own branch,
 * instructor own groups (+ groups they cover); secretaries never (same as the other LMS staff screens).
 * Only ACTIVE groups that teach a level. Maths in lib/lms/analytics-calc.ts.
 */

import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requestPlaces, visibleGroupIds } from '@/lib/places/server'
import { getTeacherByUserId, getTeacherClassSectionIds } from '@/lib/academic/teacher-scope'
import { groupLessons } from '@/lib/lms/engine'
import { groupAssignments } from '@/lib/assignments/engine'
import { parseQuiz } from '@/lib/quizzes/engine'
import { itemAnalysis, type QuizAnswer, type QuizQuestion, type QuizResult } from '@/lib/quizzes/rules'
import {
  avgOf, avgPercent, bucketWeeks, gradingHours, homeworkStats, inRange, INACTIVE_DAYS, pct, quizResults, riskReasons, weakPoints, weekStarts,
  type DueItem, type QuizInfo, type RiskReason,
} from './analytics-calc'

const DAY = 86_400_000
const MAX_GROUPS = 200

export const ANALYTICS_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'TEACHER']

export interface AnalyticsFilters { from: Date; to: Date; campusId?: string | null; trackId?: string | null; subjectId?: string | null; levelId?: string | null; teacherId?: string | null }

/** Group ids this person may analyse (null = every group). */
async function scopeGroupIds(user: { id: string; role: string; campusId?: string | null }): Promise<string[] | null> {
  const role = user.role as Role
  // M0: managers see the groups of their places
  if (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'BRANCH_MANAGER') return visibleGroupIds(await requestPlaces(user))
  if (role === 'TEACHER') {
    const t = await getTeacherByUserId(user.id)
    if (!t) return []
    const subs = (await prisma.substituteAssignment.findMany({ where: { substituteTeacherId: t.id, status: 'CONFIRMED' }, select: { classSectionId: true } })).map((s) => s.classSectionId)
    return [...new Set([...(await getTeacherClassSectionIds(t.id)), ...subs])]
  }
  return []
}

export async function lmsAnalytics(user: { id: string; role: string; campusId?: string | null }, f: AnalyticsFilters) {
  const now = new Date()
  const scope = await scopeGroupIds(user)
  const all = await prisma.classSection.findMany({
    where: { status: 'ACTIVE', levelId: { not: null }, ...(scope ? { id: { in: scope } } : {}) },
    select: {
      id: true, className: true, sectionName: true, campusId: true, startDate: true,
      campus: { select: { id: true, name: true } },
      level: { select: { id: true, name: true, subject: { select: { id: true, name: true, track: { select: { id: true, name: true } } } } } },
      subjectOfferings: { where: { teacherId: { not: null } }, select: { teacher: { select: { id: true, firstName: true, lastName: true } } } },
    },
    orderBy: [{ className: 'asc' }, { sectionName: 'asc' }],
  })
  const teachersOf = (g: (typeof all)[number]) => g.subjectOfferings.map((o) => o.teacher).filter((t): t is NonNullable<typeof t> => !!t)

  // filter choices come from every group in scope, before filtering
  const uniq = <T extends { id: string }>(xs: (T | null | undefined)[]) => [...new Map(xs.filter((x): x is T => !!x).map((x) => [x.id, x])).values()]
  const options = {
    campuses: (() => { const c = uniq(all.map((g) => g.campus)); return c.length > 1 ? c : [] })(), // M0: a choice only with more than one place
    tracks: uniq(all.map((g) => g.level?.subject?.track)),
    courses: uniq(all.map((g) => (g.level?.subject ? { id: g.level.subject.id, name: g.level.subject.name, trackId: g.level.subject.track?.id ?? null } : null))),
    levels: uniq(all.map((g) => (g.level ? { id: g.level.id, name: g.level.name, subjectId: g.level.subject?.id ?? null } : null))),
    teachers: user.role === 'TEACHER' ? [] : uniq(all.flatMap((g) => teachersOf(g).map((t) => ({ id: t.id, name: `${t.firstName} ${t.lastName}`.trim() })))),
  }

  const groups = all.filter((g) =>
    (!f.campusId || g.campusId === f.campusId) &&
    (!f.trackId || g.level?.subject?.track?.id === f.trackId) &&
    (!f.subjectId || g.level?.subject?.id === f.subjectId) &&
    (!f.levelId || g.level?.id === f.levelId) &&
    (!f.teacherId || teachersOf(g).some((t) => t.id === f.teacherId)),
  ).slice(0, MAX_GROUPS)
  const ids = groups.map((g) => g.id)
  const recent = new Date(Math.min(f.from.getTime(), now.getTime() - INACTIVE_DAYS * DAY))

  const [enrollments, views, subs, attempts] = ids.length ? await Promise.all([
    prisma.studentEnrollment.findMany({
      where: { classSectionId: { in: ids }, status: 'ACTIVE' },
      select: { studentId: true, classSectionId: true, student: { select: { firstName: true, lastName: true, registrationNumber: true, guardians: { select: { id: true, firstName: true, phoneNumber: true }, take: 1 } } } },
    }),
    prisma.lessonView.findMany({ where: { classSectionId: { in: ids }, studentId: { not: null }, kind: 'SESSION', createdAt: { gte: recent } }, select: { studentId: true, classSectionId: true, sessionId: true, createdAt: true } }),
    prisma.assignmentSubmission.findMany({ where: { classSectionId: { in: ids } }, select: { blockId: true, studentId: true, classSectionId: true, status: true, late: true, submittedAt: true, gradedAt: true, gradedById: true, score: true, maxScore: true } }),
    prisma.quizAttempt.findMany({ where: { classSectionId: { in: ids }, status: { not: 'IN_PROGRESS' } }, select: { blockId: true, studentId: true, classSectionId: true, status: true, score: true, maxScore: true, createdAt: true, submittedAt: true, gradedAt: true, gradedById: true } }),
  ]) : [[], [], [], []]

  const groupRows = []
  const risk: { studentId: string; name: string; reg: string; groupId: string; groupLabel: string; reasons: RiskReason[]; guardian: { id: string; name: string; phone: string } | null }[] = []
  const totals = { students: 0, opened: 0, expected: 0, onTime: 0, late: 0, missing: 0, pending: 0 }
  const hwRows: { score: number | null; maxScore: number | null }[] = []
  const quizPercents: number[] = []
  const gradeRows: { submittedAt: Date | null; gradedAt: Date | null; gradedById: string | null }[] = []
  const quizTitles = new Map<string, { title: string; levelName: string }>()

  for (const g of groups) {
    const label = `${g.className} ${g.sectionName}`.trim()
    const gl = await groupLessons(g.id)
    const [list, quizBlocks] = await Promise.all([
      groupAssignments(g.id, { lessons: gl }),
      gl?.edition ? prisma.curriculumBlock.findMany({ where: { sessionId: { in: gl.sessions.map((s) => s.id) }, type: 'QUIZ' }, select: { id: true, titleEn: true, data: true } }) : Promise.resolve([]),
    ])
    const quizzes: QuizInfo[] = []
    for (const b of quizBlocks) {
      const d = parseQuiz(b.data)
      if (!d) continue
      quizzes.push({ blockId: b.id, passMark: d.passMark, scoring: d.scoring })
      quizTitles.set(b.id, { title: b.titleEn || 'Quiz', levelName: `${g.level?.subject?.name ?? ''} · ${g.level?.name ?? ''}` })
    }
    const students = enrollments.filter((e) => e.classSectionId === g.id)
    const sIds = students.map((e) => e.studentId)
    const sSet = new Set(sIds)
    const gSubs = subs.filter((s) => s.classSectionId === g.id && sSet.has(s.studentId))
    const gAtts = attempts.filter((a) => a.classSectionId === g.id && sSet.has(a.studentId))
    const gViews = views.filter((v) => v.classSectionId === g.id)

    const allDue: DueItem[] = list.filter((a) => a.dueAt && a.dueAt <= now).map((a) => ({ blockId: a.blockId, dueAt: a.dueAt! }))
    const periodDue = allDue.filter((d) => inRange(d.dueAt, f.from, f.to))
    const hw = homeworkStats(sIds, periodDue, gSubs)
    const opened = new Set(gViews.filter((v) => inRange(v.createdAt, f.from, f.to)).map((v) => v.studentId)).size
    const hwGraded = gSubs.filter((s) => s.status === 'GRADED' && inRange(s.gradedAt, f.from, f.to))
    const results = quizResults(gAtts, quizzes)
    const periodResults = results.filter((r) => inRange(r.at, f.from, f.to))
    const pending = gSubs.filter((s) => s.status === 'SUBMITTED').length + gAtts.filter((a) => a.status === 'SUBMITTED').length
    const graded = [...gSubs, ...gAtts].filter((r) => inRange(r.gradedAt, f.from, f.to))

    const row = {
      id: g.id, label, campus: g.campus.name, course: g.level?.subject?.name ?? '', level: g.level?.name ?? '',
      teachers: teachersOf(g).map((t) => `${t.firstName} ${t.lastName}`.trim()),
      students: sIds.length, openPct: pct(opened, sIds.length),
      onTimePct: hw.onTimePct, latePct: hw.latePct, missingPct: hw.missingPct, homeworkDue: periodDue.length,
      homeworkAvg: avgPercent(hwGraded), quizAvg: avgOf(periodResults.map((r) => r.percent)),
      pending, gradingHours: gradingHours(graded), hasCurriculum: !!gl?.edition,
      weak: [] as string[],
    }
    row.weak = weakPoints(row)
    groupRows.push(row)

    totals.students += sIds.length; totals.opened += opened; totals.pending += pending
    totals.expected += hw.expected; totals.onTime += hw.onTime; totals.late += hw.late; totals.missing += hw.missing
    hwRows.push(...hwGraded); quizPercents.push(...periodResults.map((r) => r.percent)); gradeRows.push(...graded)

    const hasOpen = !!gl?.sessions.some((s) => s.open)
    for (const e of students) {
      const last = gViews.filter((v) => v.studentId === e.studentId).reduce<Date | null>((m, v) => (!m || v.createdAt > m ? v.createdAt : m), null)
      const reasons = riskReasons({ studentId: e.studentId, due: allDue, subs: gSubs, results, lastViewAt: last, groupHasOpenLessons: hasOpen, groupStartDate: g.startDate, now })
      if (!reasons.length) continue
      const gd = e.student.guardians[0]
      risk.push({
        studentId: e.studentId, name: `${e.student.firstName} ${e.student.lastName}`.trim(), reg: e.student.registrationNumber ?? '',
        groupId: g.id, groupLabel: label, reasons, guardian: gd ? { id: gd.id, name: gd.firstName, phone: gd.phoneNumber } : null,
      })
    }
  }

  // hardest questions (online tries of the period; paper exams have no per-question answers)
  const rich = ids.length ? await prisma.quizAttempt.findMany({
    where: { classSectionId: { in: ids }, paper: false, status: { not: 'IN_PROGRESS' }, submittedAt: { gte: f.from, lte: f.to } },
    select: { blockId: true, questions: true, answers: true, detail: true }, take: 3000, orderBy: { submittedAt: 'desc' },
  }) : []
  const hard: { blockId: string; quiz: string; level: string; id: string; textEn: string; type: string; answered: number; percentCorrect: number | null; commonWrong: string | null }[] = []
  for (const blockId of new Set(rich.map((r) => r.blockId))) {
    const rows = rich.filter((r) => r.blockId === blockId).map((a) => ({ questions: (a.questions as unknown as QuizQuestion[]) ?? [], answers: (a.answers as Record<string, QuizAnswer>) ?? {}, detail: (a.detail as unknown as QuizResult[]) ?? [] }))
    const info = quizTitles.get(blockId)
    for (const q of itemAnalysis(rows)) {
      if (q.answered >= 3 && q.percentCorrect != null && q.percentCorrect <= 60) {
        hard.push({ blockId, quiz: info?.title ?? 'Quiz', level: info?.levelName ?? '', id: q.id, textEn: q.textEn, type: q.type, answered: q.answered, percentCorrect: q.percentCorrect, commonWrong: q.commonWrong })
      }
    }
  }
  hard.sort((a, b) => (a.percentCorrect ?? 0) - (b.percentCorrect ?? 0))

  // weekly activity
  const weeks = weekStarts(f.from, f.to)
  const seen = new Set<string>()
  const lessonDates: Date[] = []
  for (const v of views) {
    if (!inRange(v.createdAt, f.from, f.to)) continue
    const k = `${v.studentId}|${v.sessionId}|${v.createdAt.toISOString().slice(0, 10)}`
    if (seen.has(k)) continue
    seen.add(k); lessonDates.push(v.createdAt)
  }
  const lessons = bucketWeeks(weeks, lessonDates)
  const homework = bucketWeeks(weeks, subs.filter((s) => s.status !== 'DRAFT').map((s) => s.submittedAt))
  const quizzesW = bucketWeeks(weeks, attempts.map((a) => a.submittedAt))

  return {
    period: { from: f.from, to: f.to },
    options,
    truncated: all.length > MAX_GROUPS && groups.length === MAX_GROUPS,
    summary: {
      groups: groups.length, students: totals.students,
      openPct: pct(totals.opened, totals.students),
      homeworkDue: totals.expected, onTimePct: pct(totals.onTime, totals.expected), latePct: pct(totals.late, totals.expected), missingPct: pct(totals.missing, totals.expected),
      homeworkAvg: avgPercent(hwRows), quizAvg: avgOf(quizPercents), gradingHours: gradingHours(gradeRows), pending: totals.pending,
    },
    groups: groupRows,
    risk: risk.sort((a, b) => b.reasons.length - a.reasons.length || a.name.localeCompare(b.name)),
    hard: hard.slice(0, 15),
    weeks: weeks.map((w, i) => ({ week: w.toISOString().slice(0, 10), lessons: lessons[i], homework: homework[i], quizzes: quizzesW[i] })),
  }
}
