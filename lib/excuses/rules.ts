/**
 * Phase C: absence-excuse settings — pure maths (tests in tests/phase-c.test.ts).
 * A rule per scope ALL | TRACK | COURSE | GROUP; the most specific one wins.
 * No rule at all = accepted automatically, up to 2 days after the session.
 */

export type ExcuseScope = 'ALL' | 'TRACK' | 'COURSE' | 'GROUP'
export interface ExcuseRuleLike { scopeType: string; scopeId: string | null; autoApprove: boolean; daysAfter: number }
export interface ExcuseSettings { autoApprove: boolean; daysAfter: number; scopeType: ExcuseScope | 'DEFAULT' }

export const EXCUSE_DEFAULT: ExcuseSettings = { autoApprove: true, daysAfter: 2, scopeType: 'DEFAULT' }
/** How far ahead a parent may excuse a session. */
export const EXCUSE_MAX_DAYS_AHEAD = 60

export function resolveExcuseRule(rules: ExcuseRuleLike[], where: { trackId?: string | null; courseId?: string | null; groupId?: string | null }): ExcuseSettings {
  const order: [ExcuseScope, string | null | undefined][] = [
    ['GROUP', where.groupId],
    ['COURSE', where.courseId],
    ['TRACK', where.trackId],
    ['ALL', null],
  ]
  for (const [scope, id] of order) {
    if (scope !== 'ALL' && !id) continue
    const r = rules.find((x) => x.scopeType === scope && (scope === 'ALL' || x.scopeId === id))
    if (r) return { autoApprove: r.autoApprove, daysAfter: Math.max(0, r.daysAfter), scopeType: scope }
  }
  return EXCUSE_DEFAULT
}

const dayMs = 86_400_000
const toMs = (d: string) => Date.parse(`${d}T00:00:00.000Z`)

/** Can a parent still send an excuse for a session on `sessionDate` (YYYY-MM-DD) when today is `today`? */
export function excuseWindow(sessionDate: string, today: string, daysAfter: number): { ok: boolean; reason?: string } {
  const diff = Math.round((toMs(today) - toMs(sessionDate)) / dayMs) // days since the session (negative = future)
  if (diff > daysAfter) return { ok: false, reason: daysAfter === 0 ? 'Excuses must be sent before or on the day of the session' : `Excuses can be sent up to ${daysAfter} day(s) after the session` }
  if (-diff > EXCUSE_MAX_DAYS_AHEAD) return { ok: false, reason: `Excuses can be sent at most ${EXCUSE_MAX_DAYS_AHEAD} days ahead` }
  return { ok: true }
}
