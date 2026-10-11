/**
 * R2 skills chart — pure maths. Every graded question / homework counts for the skills it is tagged with (none = the
 * skills of its lesson). Per skill: points earned / points possible. Tests: tests/skills-calc.test.ts.
 */

export interface SkillItem { skillIds: string[]; points: number; max: number }
export interface SkillDef { id: string; nameEn: string; nameAr: string }
export interface SkillScore extends SkillDef { percent: number | null; items: number }

export const STRONG_AT = 75
export const WEAK_BELOW = 50

/** Per course skill: % earned (null when nothing measured it yet). */
export function skillScores(items: SkillItem[], skills: SkillDef[]): SkillScore[] {
  const known = new Set(skills.map((s) => s.id))
  const sum = new Map<string, { p: number; m: number; n: number }>()
  for (const it of items) {
    if (!(it.max > 0)) continue
    for (const id of new Set(it.skillIds)) {
      if (!known.has(id)) continue
      const s = sum.get(id) ?? { p: 0, m: 0, n: 0 }
      s.p += Math.max(0, Math.min(it.points, it.max)); s.m += it.max; s.n++
      sum.set(id, s)
    }
  }
  return skills.map((k) => {
    const s = sum.get(k.id)
    return { ...k, percent: s && s.m > 0 ? Math.round((s.p / s.m) * 100) : null, items: s?.n ?? 0 }
  })
}

/** Which tries of one quiz count (same rule as the quiz score: best, last or all for an average). */
export function countedAttempts<T extends { score: number | null; maxScore: number | null; createdAt: Date }>(attempts: T[], scoring: 'BEST' | 'LAST' | 'AVERAGE'): T[] {
  const done = attempts.filter((a) => a.score != null && !!a.maxScore)
  if (!done.length) return []
  if (scoring === 'AVERAGE') return done
  if (scoring === 'LAST') return [[...done].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]]
  return [[...done].sort((a, b) => b.score! / b.maxScore! - a.score! / a.maxScore!)[0]]
}

/** Strongest and weakest measured skills (for a sentence in the report). */
export function strongWeak(scores: SkillScore[]) {
  const measured = scores.filter((s) => s.percent != null)
  return {
    strong: measured.filter((s) => s.percent! >= STRONG_AT).sort((a, b) => b.percent! - a.percent!).slice(0, 3),
    weak: measured.filter((s) => s.percent! < WEAK_BELOW).sort((a, b) => a.percent! - b.percent!).slice(0, 3),
  }
}

/** The most used ready phrase (id) in a list of phrase-id lists. */
export function topPhrase(lists: (string[] | null | undefined)[]): string | null {
  const c = new Map<string, number>()
  for (const l of lists) for (const id of new Set(l ?? [])) c.set(id, (c.get(id) ?? 0) + 1)
  let best: string | null = null, n = 0
  for (const [id, k] of c) if (k > n) { best = id; n = k }
  return best
}
