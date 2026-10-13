/**
 * M0: instructor employment periods (owner 2026-10-13). Pure — tested in tests/teacher-employment.test.ts.
 * A trainee is not paid; an instructor employed by a partner is paid by the partner, not by TechNova.
 * No periods recorded = paid by TechNova as before (nothing changes for existing instructors).
 */

export interface EmploymentPeriod { employer: string; kind: string; fromDate: Date; toDate: Date | null }

const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

/** Is TechNova paying this instructor on that day? */
export function paidByTechNovaOn(periods: EmploymentPeriod[], date: Date): boolean {
  if (!periods.length) return true
  const t = day(date)
  const p = periods.find((x) => day(x.fromDate) <= t && (!x.toDate || t <= day(x.toDate)))
  return !!p && p.employer === 'TECHNOVA' && p.kind === 'TEACHER'
}

/** Is TechNova paying for at least one day in [from, to]? (fixed / percent parts of a cycle) */
export function paidByTechNovaBetween(periods: EmploymentPeriod[], from: Date, to: Date): boolean {
  if (!periods.length) return true
  return periods.some((p) => p.employer === 'TECHNOVA' && p.kind === 'TEACHER' && day(p.fromDate) <= day(to) && (!p.toDate || day(p.toDate) >= day(from)))
}

/** Periods must not overlap and must end after they start. */
export function periodsProblem(periods: EmploymentPeriod[]): string | null {
  const s = [...periods].sort((a, b) => a.fromDate.getTime() - b.fromDate.getTime())
  for (const [i, p] of s.entries()) {
    if (p.toDate && day(p.toDate) < day(p.fromDate)) return 'A period ends before it starts'
    const next = s[i + 1]
    if (next && (!p.toDate || day(p.toDate) >= day(next.fromDate))) return 'Two periods overlap'
  }
  return null
}

/** Pay rule level: group override → the place's rate for this instructor → the instructor's default. */
export function pickPayRule<T extends { fixed: unknown; percent: unknown; perSession: unknown }>(group: T | null, place: T | null, teacher: T | null): { rule: T | null; source: 'GROUP_OVERRIDE' | 'PLACE_RATE' | 'TEACHER_DEFAULT' | 'NONE' } {
  const has = (r: T | null) => !!r && (r.fixed != null || r.percent != null || r.perSession != null)
  if (has(group)) return { rule: group, source: 'GROUP_OVERRIDE' }
  if (has(place)) return { rule: place, source: 'PLACE_RATE' }
  if (teacher) return { rule: teacher, source: 'TEACHER_DEFAULT' }
  return { rule: null, source: 'NONE' }
}
