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
  /** a postponement must be at least this many hours before the session */
  cancelHours: number
  /** postponements of a family in a month */
  postponesPerMonth: number
  /** minutes the instructor waits before a no-show */
  noShowWaitMinutes: number
  /** % of the session pay the instructor keeps when the student does not come */
  noShowPayPct: number
  /** sessions missed without notice before the fixed time is released */
  noShowLimit: number
  /** days the fixed time stays held after the last session of a cycle */
  holdDays: number
  /** cycles a session not used can be carried over */
  carryMonths: number
  /** parents may ask for a male or female instructor */
  genderPreference: boolean
}

export const DEFAULT_ONE_TO_ONE_SETTINGS: OneToOneSettings = { portalOpen: true, assignWithoutAsking: false, replyHours: 12, parentPicksInstructor: false, parentPresentUnderAge: 7, cancelHours: 24, postponesPerMonth: 2, noShowWaitMinutes: 15, noShowPayPct: 50, noShowLimit: 3, holdDays: 7, carryMonths: 1, genderPreference: false }

const within = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Math.round(Number(v ?? fallback))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

export function cleanOneToOneSettings(v: Partial<OneToOneSettings>): OneToOneSettings {
  const d = DEFAULT_ONE_TO_ONE_SETTINGS
  const hours = Math.round(Number(v.replyHours ?? d.replyHours))
  const age = Math.round(Number(v.parentPresentUnderAge ?? d.parentPresentUnderAge))
  return {
    portalOpen: v.portalOpen ?? d.portalOpen, assignWithoutAsking: v.assignWithoutAsking ?? d.assignWithoutAsking, parentPicksInstructor: v.parentPicksInstructor ?? d.parentPicksInstructor,
    replyHours: Number.isFinite(hours) ? Math.min(168, Math.max(1, hours)) : d.replyHours,
    parentPresentUnderAge: Number.isFinite(age) ? Math.min(25, Math.max(0, age)) : d.parentPresentUnderAge,
    cancelHours: within(v.cancelHours, d.cancelHours, 0, 720), postponesPerMonth: within(v.postponesPerMonth, d.postponesPerMonth, 0, 50),
    noShowWaitMinutes: within(v.noShowWaitMinutes, d.noShowWaitMinutes, 0, 120), noShowPayPct: within(v.noShowPayPct, d.noShowPayPct, 0, 100), noShowLimit: within(v.noShowLimit, d.noShowLimit, 1, 50),
    holdDays: within(v.holdDays, d.holdDays, 0, 90), carryMonths: within(v.carryMonths, d.carryMonths, 0, 12), genderPreference: v.genderPreference ?? d.genderPreference,
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

/** Why a family may not postpone this session now, or null. */
export function postponeProblem(hoursBefore: number, usedThisMonth: number, s: Pick<OneToOneSettings, 'cancelHours' | 'postponesPerMonth'>): string | null {
  if (hoursBefore < s.cancelHours) return `A session can be moved up to ${s.cancelHours} hours before it · الحصة بتتأجل قبلها بـ ${s.cancelHours} ساعة على الأقل`
  if (usedThisMonth >= s.postponesPerMonth) return `${s.postponesPerMonth} postponements a month are already used · خلصت التأجيلات بتوع الشهر (${s.postponesPerMonth})`
  return null
}

/** Days everybody in the session was marked absent (an excused absence is not a no-show). */
export function noShowDays(rows: { date: string; status: string }[]): Set<string> {
  const by = new Map<string, string[]>()
  for (const r of rows) by.set(r.date, [...(by.get(r.date) ?? []), r.status])
  return new Set([...by].filter(([, st]) => st.length > 0 && st.every((x) => x === 'ABSENT')).map(([d]) => d))
}

/** Sessions not used that go into the next cycle: at most `carryMonths` plans' worth. */
export function carryCount(left: number, baseSessions: number, carryMonths: number): number {
  return Math.max(0, Math.min(left, baseSessions * Math.max(0, carryMonths)))
}

/** A cycle may be renewed with sessions left once its month has passed (or at once when all sessions are done). */
export function canCarryNow(cycleStart: string | null, today: string, left: number): boolean {
  if (left <= 0 || !cycleStart) return false
  return (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${cycleStart}T00:00:00Z`).getTime()) / 86_400_000 >= 28
}

/** Past the time a finished cycle's fixed time stays held? */
export function holdOver(lastSession: string | null, today: string, holdDays: number): boolean {
  if (!lastSession) return false
  return (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${lastSession}T00:00:00Z`).getTime()) / 86_400_000 > holdDays
}
