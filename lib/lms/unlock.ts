/**
 * LMS L2 — which curriculum sessions are open for a group (pure, tested in tests/lms-unlock.test.ts).
 *
 * Numbers: a level's curriculum has sessions 1..N. A MONTHLY level is taught as several groups (one per month,
 * `currentCycleNumber`), so this group's sessions are offset+1 .. offset+perCycle with offset = (cycle - 1) × perCycle.
 * Sessions of earlier months are always open (revision); sessions after this month are locked (except mode ALL).
 *
 * Modes (owner default 2026-10-09 = ATTENDANCE; level default, group override):
 *  ALL        every session of the level is open
 *  SCHEDULE   opens when its scheduled start time is reached
 *  ATTENDANCE opens when the attendance of that session is recorded
 *  MANUAL     only the instructor opens it
 *  PREVIOUS   opens when the student finished the previous session (per student)
 * The instructor's own OPEN / LOCKED on a session always wins.
 */

export const UNLOCK_MODES = ['ALL', 'SCHEDULE', 'ATTENDANCE', 'MANUAL', 'PREVIOUS'] as const
export type UnlockMode = (typeof UNLOCK_MODES)[number]
export const DEFAULT_UNLOCK_MODE: UnlockMode = 'ATTENDANCE'

export const isUnlockMode = (m: unknown): m is UnlockMode => typeof m === 'string' && (UNLOCK_MODES as readonly string[]).includes(m)

/** Group override > level default > company default. */
export function effectiveMode(groupMode: string | null | undefined, levelMode: string | null | undefined, companyMode: string | null | undefined): UnlockMode {
  if (isUnlockMode(groupMode)) return groupMode
  if (isUnlockMode(levelMode)) return levelMode
  if (isUnlockMode(companyMode)) return companyMode
  return DEFAULT_UNLOCK_MODE
}

export interface UnlockInput {
  mode: UnlockMode
  /** curriculum sessions in the edition (1..total) */
  totalSessions: number
  /** sessions per month (one group) */
  perCycle: number
  /** 1-based month of this group in the level */
  cycleNumber: number
  /** sessions of THIS group already held (attendance recorded) */
  heldCount: number
  /** start time (ISO) of upcoming sessions of this group, by session number inside the month */
  scheduledStarts?: Record<number, string>
  /** instructor overrides by curriculum session number */
  overrides?: Record<number, 'OPEN' | 'LOCKED'>
  /** curriculum session numbers the student finished (PREVIOUS mode) */
  completed?: Set<number>
  now: Date
}

export type UnlockReason = 'EARLIER_MONTH' | 'ALL' | 'HELD' | 'TIME' | 'INSTRUCTOR' | 'PREVIOUS_DONE' | 'FIRST'
export interface SessionState { number: number; open: boolean; reason?: UnlockReason; current: boolean; inThisGroup: boolean }

export function cycleRange(perCycle: number, cycleNumber: number, totalSessions: number) {
  const per = Math.max(1, perCycle)
  const from = (Math.max(1, cycleNumber) - 1) * per + 1
  return { from, to: Math.min(totalSessions, from + per - 1) }
}

export function sessionStates(i: UnlockInput): SessionState[] {
  const { from, to } = cycleRange(i.perCycle, i.cycleNumber, i.totalSessions)
  const held = Math.max(0, Math.min(i.heldCount, to - from + 1))
  const current = held > 0 ? from + held - 1 : null
  const out: SessionState[] = []
  for (let n = 1; n <= i.totalSessions; n++) {
    const inThisGroup = n >= from && n <= to
    const st: SessionState = { number: n, open: false, current: n === current, inThisGroup }
    const ov = i.overrides?.[n]
    if (ov === 'OPEN') { st.open = true; st.reason = 'INSTRUCTOR' }
    else if (ov === 'LOCKED') st.open = false
    else if (i.mode === 'ALL') { st.open = true; st.reason = 'ALL' }
    else if (n < from) { st.open = true; st.reason = 'EARLIER_MONTH' }
    else if (!inThisGroup) st.open = false
    else if (n - from < held && i.mode !== 'MANUAL' && i.mode !== 'PREVIOUS') { st.open = true; st.reason = 'HELD' }
    if (!st.open && ov !== 'LOCKED' && inThisGroup) {
      if (i.mode === 'SCHEDULE') {
        const start = i.scheduledStarts?.[n - from + 1]
        if (start && new Date(start).getTime() <= i.now.getTime()) { st.open = true; st.reason = 'TIME' }
      } else if (i.mode === 'PREVIOUS') {
        if (n === 1) { st.open = true; st.reason = 'FIRST' }
        else if (i.completed?.has(n - 1)) { st.open = true; st.reason = 'PREVIOUS_DONE' }
      }
    }
    out.push(st)
  }
  return out
}

/** A student finished a session when every block they can see is ticked (a session with no blocks counts as done once opened). */
export function sessionDone(visibleBlockIds: string[], doneBlockIds: Set<string>): boolean {
  return visibleBlockIds.every((id) => doneBlockIds.has(id))
}
