/**
 * a02 M3 batch 2 — parent requests: pure rules (tests/one-to-one.test.ts).
 * A request goes to one qualified, free instructor at a time. No answer in `replyHours` or a decline → the next one.
 * Nobody left → NO_TEACHER, and the staff place it. `assignWithoutAsking` books the first one at once.
 */

export interface OneToOneSettings {
  /** parents can ask from their portal */
  portalOpen: boolean
  /** book with the first free instructor without asking him */
  assignWithoutAsking: boolean
  /** hours an instructor has to answer */
  replyHours: number
  /** parents see free instructors by name and may choose one */
  parentPicksInstructor: boolean
  /** online: suggest that a parent stays with a child younger than this */
  parentPresentUnderAge: number
}

export const DEFAULT_ONE_TO_ONE_SETTINGS: OneToOneSettings = { portalOpen: true, assignWithoutAsking: false, replyHours: 12, parentPicksInstructor: false, parentPresentUnderAge: 7 }

export function cleanOneToOneSettings(v: Partial<OneToOneSettings>): OneToOneSettings {
  const d = DEFAULT_ONE_TO_ONE_SETTINGS
  const hours = Math.round(Number(v.replyHours ?? d.replyHours))
  const age = Math.round(Number(v.parentPresentUnderAge ?? d.parentPresentUnderAge))
  return {
    portalOpen: v.portalOpen ?? d.portalOpen, assignWithoutAsking: v.assignWithoutAsking ?? d.assignWithoutAsking, parentPicksInstructor: v.parentPicksInstructor ?? d.parentPicksInstructor,
    replyHours: Number.isFinite(hours) ? Math.min(168, Math.max(1, hours)) : d.replyHours,
    parentPresentUnderAge: Number.isFinite(age) ? Math.min(25, Math.max(0, age)) : d.parentPresentUnderAge,
  }
}

/** The next instructor to ask: the one the parent chose first (if still free), then the others; never someone who already passed. */
export function nextCandidate(free: string[], tried: string[], preferred?: string | null): string | null {
  const left = free.filter((id) => !tried.includes(id))
  if (preferred && left.includes(preferred)) return preferred
  return left[0] ?? null
}

/** Suggest a parent stays in online sessions? (young child, age known) */
export function suggestParentPresent(age: number | null, slots: { mode?: string | null }[], underAge: number): boolean {
  return age != null && age < underAge && slots.some((s) => s.mode === 'ONLINE')
}
