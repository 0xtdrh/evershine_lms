import { prisma } from '@/lib/prisma'

export interface ComponentScores {
  homeworkScore: number | null
  taskScore: number | null
  instructorScore: number | null
  projectScore: number | null
  mcqScore: number | null
}

/**
 * Returns the CourseGradingConfig that applies to a given course: the
 * course-specific override if one exists, otherwise the global default.
 * WHY always-non-null: a global default row is guaranteed to exist (the
 * grading-config GET route creates one on first access), so callers can
 * assume this never returns null in normal operation.
 */
export async function resolveGradingConfig(subjectId: string) {
  const override = await prisma.courseGradingConfig.findFirst({ where: { subjectId } })
  if (override) return override

  let globalDefault = await prisma.courseGradingConfig.findFirst({ where: { subjectId: null } })
  if (!globalDefault) {
    globalDefault = await prisma.courseGradingConfig.create({ data: { subjectId: null } })
  }
  return globalDefault
}

/**
 * Computes the weighted final score (0-100) from the five component scores.
 * Returns null if any component is still missing — a result cannot be
 * finalized (and no certificate generated) until every component is entered.
 */
export function computeFinalScore(
  scores: ComponentScores,
  weights: {
    homeworkWeight: number
    taskWeight: number
    instructorWeight: number
    projectWeight: number
    mcqWeight: number
  }
): number | null {
  const { homeworkScore, taskScore, instructorScore, projectScore, mcqScore } = scores
  if (
    homeworkScore == null ||
    taskScore == null ||
    instructorScore == null ||
    projectScore == null ||
    mcqScore == null
  ) {
    return null
  }

  const weightedSum =
    (homeworkScore * weights.homeworkWeight) +
    (taskScore * weights.taskWeight) +
    (instructorScore * weights.instructorWeight) +
    (projectScore * weights.projectWeight) +
    (mcqScore * weights.mcqWeight)

  // Weights are stored as 0-100 percentages, so divide by 100 to normalize.
  return Math.round((weightedSum / 100) * 100) / 100
}
