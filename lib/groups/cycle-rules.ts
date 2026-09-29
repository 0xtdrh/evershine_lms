/**
 * The ONE rule for "how many sessions make one cycle (one group)".
 * Used by the cycle-closing check, session numbering, remaining-session
 * listings (teacher absences / substitutes) and the end-date estimates, so
 * they can never disagree.
 *
 * Rule (confirmed by the owner, 2026-09-29):
 *  - MONTHLY pricing: one cycle = one month = numberOfSessions / numberOfMonths
 *    sessions. At the end, staff choose who continues into the next month.
 *  - FULL_LEVEL pricing (one invoice for the whole level): one cycle = the
 *    WHOLE level = numberOfSessions. At the end, the group moves to the next
 *    level. (Before this, such a group closed after one month of sessions and
 *    jumped to the next level, i.e. students got half a 2-month level.)
 */

export interface LevelForCycle {
  numberOfSessions: number
  numberOfMonths: number
  pricingType?: 'MONTHLY' | 'FULL_LEVEL' | string
}

export function sessionsPerCycle(level: LevelForCycle): number {
  if (level.pricingType === 'FULL_LEVEL') return Math.max(1, level.numberOfSessions)
  return Math.max(1, Math.round(level.numberOfSessions / Math.max(1, level.numberOfMonths)))
}

/** How many cycles (groups) a level has in total. */
export function cyclesInLevel(level: LevelForCycle): number {
  return level.pricingType === 'FULL_LEVEL' ? 1 : Math.max(1, level.numberOfMonths)
}
