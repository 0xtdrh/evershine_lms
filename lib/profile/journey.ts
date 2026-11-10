/**
 * The inventor's journey (2026-11-10, owner): the islands map, the details of each level, the title, the timeline.
 * Pure, tests in tests/profile-journey.test.ts. Money never appears here.
 */

/** Stars of a finished level from its final result: 90+ = 3, 75+ = 2, passed = 1, not final yet = 0. */
export function levelStars(r: { finalScore: number | null; passed: boolean | null }): number {
  if (r.passed !== true || r.finalScore == null) return 0
  return r.finalScore >= 90 ? 3 : r.finalScore >= 75 ? 2 : 1
}

/** The title on the cover grows with the levels finished. */
export function inventorTitle(levelsDone: number) {
  if (levelsDone >= 6) return { en: 'Expert inventor', ar: 'مخترع خبير' }
  if (levelsDone >= 3) return { en: 'Innovator', ar: 'مبتكر' }
  if (levelsDone >= 1) return { en: 'Young engineer', ar: 'مهندس صغير' }
  return { en: 'New inventor', ar: 'مخترع مبتدئ' }
}

/** What is still left in the current level. */
export function whatIsLeft(i: { totalSessions: number; heldSessions: number; homeworkSet: number; homeworkHanded: number; resultFinal: boolean }) {
  return {
    sessions: Math.max(0, i.totalSessions - i.heldSessions),
    homework: Math.max(0, i.homeworkSet - i.homeworkHanded),
    finalResult: !i.resultFinal,
  }
}

export interface TimelineEvent { at: string; kind: 'JOINED' | 'LEVEL_STARTED' | 'LEVEL_DONE' | 'CERTIFICATE' | 'PROJECT' | 'STAMP'; en: string; ar: string }

/** Oldest first; the same event is kept once. */
export function timeline(events: TimelineEvent[], limit = 40): TimelineEvent[] {
  const seen = new Set<string>()
  return events
    .filter((e) => e.at && !Number.isNaN(new Date(e.at).getTime()))
    .sort((a, b) => a.at.localeCompare(b.at))
    .filter((e) => { const k = `${e.kind}|${e.en}|${e.at.slice(0, 10)}`; if (seen.has(k)) return false; seen.add(k); return true })
    .slice(-limit)
}

export const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null)

/** The map's look by age (owner 2026-11-10): young = big stations, few words; older = calmer, numbers shown. */
export type MapLook = 'YOUNG' | 'MIDDLE' | 'OLDER'
export const YOUNG_UNTIL = 8
export function mapLook(age: number | null, olderAge: number): MapLook {
  if (age == null || !Number.isFinite(age)) return 'MIDDLE'
  if (age <= YOUNG_UNTIL) return 'YOUNG'
  return age >= olderAge ? 'OLDER' : 'MIDDLE'
}
