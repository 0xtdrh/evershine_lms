/**
 * R2: LMS part of the monthly and level reports — homework handed in + average, quiz average, stars from the session
 * reports, projects in the gallery, the instructor's latest comment + most used phrase, and the skills chart.
 * Server-only. Pure maths: lib/skills/calc.ts, lib/lms/analytics-calc.ts.
 */

import { prisma } from '@/lib/prisma'
import { groupLessons } from '@/lib/lms/engine'
import { groupAssignments } from '@/lib/assignments/engine'
import { parseQuiz } from '@/lib/quizzes/engine'
import { getSessionReportSettings } from '@/lib/session-reports/engine'
import type { QuizQuestion, QuizResult } from '@/lib/quizzes/rules'
import { avgOf, avgPercent, homeworkStats, quizResults } from '@/lib/lms/analytics-calc'
import { countedAttempts, skillScores, strongWeak, topPhrase, type SkillItem } from '@/lib/skills/calc'

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** Skills chart of a student over some groups of one course (null when the course has no skills list). */
export async function studentSkills(studentId: string, groupIds: string[], subjectId: string | null | undefined) {
  if (!subjectId || !groupIds.length) return null
  const skills = await prisma.courseSkill.findMany({ where: { subjectId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }], select: { id: true, nameEn: true, nameAr: true } })
  if (!skills.length) return null
  const [atts, subs] = await Promise.all([
    prisma.quizAttempt.findMany({ where: { studentId, classSectionId: { in: groupIds }, status: 'GRADED' }, select: { blockId: true, questions: true, detail: true, score: true, maxScore: true, createdAt: true, paper: true } }),
    prisma.assignmentSubmission.findMany({ where: { studentId, classSectionId: { in: groupIds }, status: 'GRADED' }, select: { blockId: true, score: true, maxScore: true } }),
  ])
  const blockIds = [...new Set([...atts.map((a) => a.blockId), ...subs.map((s) => s.blockId)])]
  if (!blockIds.length) return { scores: skillScores([], skills), ...strongWeak([]) }
  const blocks = await prisma.curriculumBlock.findMany({ where: { id: { in: blockIds } }, select: { id: true, sessionId: true, data: true } })
  const sessions = await prisma.curriculumSession.findMany({ where: { id: { in: [...new Set(blocks.map((b) => b.sessionId))] } }, select: { id: true, skillIds: true } })
  const sessionSkills = (blockId: string) => {
    const b = blocks.find((x) => x.id === blockId)
    return ((sessions.find((s) => s.id === b?.sessionId)?.skillIds as string[] | null) ?? [])
  }
  const items: SkillItem[] = []
  for (const blockId of new Set(atts.map((a) => a.blockId))) {
    const quiz = parseQuiz(blocks.find((b) => b.id === blockId)?.data)
    const counted = countedAttempts(atts.filter((a) => a.blockId === blockId), quiz?.scoring ?? 'BEST')
    for (const a of counted) {
      const detail = (a.detail as unknown as QuizResult[] | null) ?? []
      if (a.paper || !detail.length) { items.push({ skillIds: sessionSkills(blockId), points: a.score ?? 0, max: a.maxScore ?? 0 }); continue }
      const qs = (a.questions as unknown as QuizQuestion[] | null) ?? []
      for (const d of detail) {
        const q = qs.find((x) => x.id === d.id)
        items.push({ skillIds: q?.skillIds?.length ? q.skillIds : sessionSkills(blockId), points: d.points, max: d.max })
      }
    }
  }
  for (const s of subs) {
    const data = blocks.find((b) => b.id === s.blockId)?.data as { skillIds?: string[] } | null
    items.push({ skillIds: data?.skillIds?.length ? data.skillIds : sessionSkills(s.blockId), points: s.score ?? 0, max: s.maxScore ?? 0 })
  }
  const scores = skillScores(items, skills)
  return { scores, ...strongWeak(scores) }
}

/** Stars, projects and the instructor's words over some groups. */
async function extras(studentId: string, groupIds: string[]) {
  const [rows, projects, settings] = await Promise.all([
    prisma.sessionReportStudent.findMany({
      where: { studentId, report: { classSectionId: { in: groupIds }, status: 'SENT' } },
      select: { star: true, phrases: true, comment: true, report: { select: { sessionDate: true } } },
    }),
    prisma.assignmentSubmission.findMany({ where: { studentId, classSectionId: { in: groupIds }, galleryStatus: 'APPROVED' }, select: { blockId: true, galleryAt: true }, orderBy: { galleryAt: 'desc' }, take: 12 }),
    getSessionReportSettings(),
  ])
  const titles = projects.length ? await prisma.curriculumBlock.findMany({ where: { id: { in: projects.map((p) => p.blockId) } }, select: { id: true, titleEn: true, titleAr: true } }) : []
  const withComment = rows.filter((r) => r.comment).sort((a, b) => b.report.sessionDate.getTime() - a.report.sessionDate.getTime())[0]
  const top = topPhrase(rows.map((r) => r.phrases as string[] | null))
  const phrase = top ? settings.phrases.find((p) => p.id === top) : null
  return {
    stars: rows.filter((r) => r.star).length,
    projects: projects.map((p) => {
      const t = titles.find((x) => x.id === p.blockId)
      return { titleEn: t?.titleEn || 'Project', titleAr: t?.titleAr || t?.titleEn || 'مشروع' }
    }),
    quote: withComment ? { text: withComment.comment!, date: ymd(withComment.report.sessionDate) } : null,
    topPhrase: phrase ? { en: phrase.en, ar: phrase.ar || phrase.en } : null,
  }
}

/** Monthly report: this group (= this month) only. */
export async function lmsMonthSummary(studentId: string, groupId: string, subjectId: string | null | undefined) {
  const gl = await groupLessons(groupId).catch(() => null)
  const now = new Date()
  let homework = { due: 0, handedInPct: null as number | null, onTimePct: null as number | null, average: null as number | null }
  let quizAverage: number | null = null
  if (gl?.edition) {
    const inMonth = new Set<string>(gl.sessions.filter((s) => s.number >= gl.range.from && s.number <= gl.range.to).map((s) => s.id as string))
    const list = (await groupAssignments(groupId, { lessons: gl })).filter((a) => inMonth.has(a.sessionId))
    const subs = await prisma.assignmentSubmission.findMany({ where: { classSectionId: groupId, studentId, blockId: { in: list.map((a) => a.blockId) } }, select: { blockId: true, studentId: true, status: true, late: true, submittedAt: true, gradedAt: true, gradedById: true, score: true, maxScore: true } })
    const due = list.filter((a) => a.dueAt && a.dueAt <= now).map((a) => ({ blockId: a.blockId, dueAt: a.dueAt! }))
    const st = homeworkStats([studentId], due, subs)
    homework = { due: due.length, handedInPct: st.expected ? Math.round(((st.onTime + st.late) / st.expected) * 100) : null, onTimePct: st.onTimePct, average: avgPercent(subs.filter((s) => s.status === 'GRADED')) }
    const qBlocks = await prisma.curriculumBlock.findMany({ where: { sessionId: { in: [...inMonth] }, type: 'QUIZ' }, select: { id: true, data: true } })
    const quizzes = qBlocks.flatMap((b) => { const d = parseQuiz(b.data); return d ? [{ blockId: b.id, passMark: d.passMark, scoring: d.scoring }] : [] })
    if (quizzes.length) {
      const atts = await prisma.quizAttempt.findMany({ where: { classSectionId: groupId, studentId, blockId: { in: quizzes.map((q) => q.blockId) } }, select: { blockId: true, studentId: true, status: true, score: true, maxScore: true, createdAt: true, submittedAt: true, gradedAt: true, gradedById: true } })
      quizAverage = avgOf(quizResults(atts, quizzes).map((r) => r.percent))
    }
  }
  const [ex, skills] = await Promise.all([extras(studentId, [groupId]), studentSkills(studentId, [groupId], subjectId)])
  return { homework, quizAverage, ...ex, skills }
}

/** Level report: every group of the level the student was in. */
export async function lmsLevelSummary(studentId: string, groupIds: string[], subjectId: string | null | undefined) {
  const [ex, skills] = await Promise.all([extras(studentId, groupIds), studentSkills(studentId, groupIds, subjectId)])
  return { ...ex, skills }
}
