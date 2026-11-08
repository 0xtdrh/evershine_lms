/**
 * The months of a group (b03, 2026-11-08). Each billing cycle is a NEW group; GroupCycleLog links one to the next
 * (classSectionId → newClassSectionId), so walking those links gives the whole history. Pure, tests/group-months.test.ts.
 */

export interface CycleLink { from: string; to: string; at: Date | string }

/** Every group of the chain, oldest first. Safe against loops; a group advanced twice follows its latest link. */
export function walkChain(links: CycleLink[], id: string, limit = 120): string[] {
  const next = new Map<string, CycleLink>()
  const prev = new Map<string, CycleLink>()
  const time = (l: CycleLink) => new Date(l.at).getTime()
  for (const l of links) {
    if (l.from === l.to) continue
    const n = next.get(l.from)
    if (!n || time(l) > time(n)) next.set(l.from, l)
    const p = prev.get(l.to)
    if (!p || time(l) > time(p)) prev.set(l.to, l)
  }
  const seen = new Set([id])
  const before: string[] = []
  for (let c = prev.get(id)?.from; c && !seen.has(c) && seen.size < limit; c = prev.get(c)?.from) { seen.add(c); before.unshift(c) }
  const after: string[] = []
  for (let c = next.get(id)?.to; c && !seen.has(c) && seen.size < limit; c = next.get(c)?.to) { seen.add(c); after.push(c) }
  return [...before, id, ...after]
}

/** Attendance %: present + late count as attended; an EXCUSED absence counts as absent (owner rule). null = nothing recorded. */
export function attendancePct(statuses: string[]): number | null {
  if (!statuses.length) return null
  return Math.round((statuses.filter((s) => s === 'PRESENT' || s === 'LATE').length / statuses.length) * 100)
}

export interface MonthStudent { id: string; name: string; transferred: boolean }

/** Who went on to the next month and who stopped. Moved to another group = neither (he did not stop). No next month yet = null. */
export function whoContinued(students: MonthStudent[], nextIds: string[] | null) {
  if (!nextIds) return null
  const next = new Set(nextIds)
  const continued = students.filter((s) => next.has(s.id)).length
  const stopped = students.filter((s) => !next.has(s.id) && !s.transferred).map((s) => ({ id: s.id, name: s.name }))
  return { continued, stopped }
}
