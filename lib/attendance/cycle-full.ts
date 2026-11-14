/**
 * F12 (final test 14/11), pure: may attendance be taken on `date`?
 * A month of N sessions is full once N different dates were held. A date already held can still be corrected.
 */
export function cycleIsFull(heldDates: string[], sessionsPerCycle: number, date: string): boolean {
  if (sessionsPerCycle <= 0) return false
  const held = new Set(heldDates)
  if (held.has(date)) return false
  return held.size >= sessionsPerCycle
}
