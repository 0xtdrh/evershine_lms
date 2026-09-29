/**
 * The ONE rule for "how many sessions make one cycle (one group)".
 * Used by the cycle-closing check, session numbering, remaining-session
 * listings (teacher absences / substitutes) and the end-date estimates, so
 * they can never disagree.
 *
 * Current rule (unchanged): numberOfSessions / numberOfMonths, i.e. one
 * month's worth of sessions per cycle — for every pricing type.
 * OPEN QUESTION to the owner (2026-09-29): for FULL_LEVEL pricing (one invoice
 * for the whole level) should one cycle be the WHOLE level? Today such a group
 * closes after one month of sessions and advance-cycle moves it to the NEXT
 * level. Change it here only after the owner confirms.
 */

export interface LevelForCycle {
  numberOfSessions: number
  numberOfMonths: number
  pricingType?: 'MONTHLY' | 'FULL_LEVEL' | string
}

export function sessionsPerCycle(level: LevelForCycle): number {
  return Math.max(1, Math.round(level.numberOfSessions / Math.max(1, level.numberOfMonths)))
}

/** How many cycles (groups) a level has in total. */
export function cyclesInLevel(level: LevelForCycle): number {
  return level.pricingType === 'FULL_LEVEL' ? 1 : Math.max(1, level.numberOfMonths)
}
