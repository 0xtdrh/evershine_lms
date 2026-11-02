/**
 * a02 M1 batch 6 (2026-10-31, owner) — instructor pay by the way a session is taught. Pure (tests/online-pay.test.ts).
 * Every pay rule (group override / place rate / instructor default) may hold an ONLINE amount beside each part:
 *   per session  → each ONLINE session is paid the online rate; a BRANCH session the normal rate; a RECORDED session is
 *                  not paid per session (the instructor does not teach it live);
 *   percent      → the online % when the GROUP is online, else the normal %;
 *   fixed        → the online amount when the GROUP is online, else the normal amount.
 * An empty online amount = the normal amount, so existing pay never changes. A group is online when its place is the
 * Online place or every slot of its schedule is ONLINE (a mixed group keeps the normal % / fixed; its sessions split).
 */

import type { Mode } from '@/lib/delivery/modes'

export interface OnlineParts { onlineFixed?: number | null; onlinePercent?: number | null; onlinePerSession?: number | null; /** a02 M3 */ oneToOnePerSession?: number | null }
export interface RuleWithOnline extends OnlineParts { fixed: number | null; percent: number | null; perSession: number | null }

const set = (v: number | null | undefined) => v != null && Number.isFinite(v)

/** The per-session rate of one session taught this way (null = no per-session pay). */
export function sessionRate(rule: RuleWithOnline, mode: Mode | null | undefined, oneToOne = false): number | null {
  if (mode === 'RECORDED') return null
  // a02 M3: a One-to-One session has its own rate (empty = as usual)
  if (oneToOne && set(rule.oneToOnePerSession)) return rule.oneToOnePerSession as number
  if (mode === 'ONLINE' && set(rule.onlinePerSession)) return rule.onlinePerSession as number
  return rule.perSession
}

export function groupIsOnline(campusKind: string | null | undefined, slots: unknown): boolean {
  if (campusKind === 'ONLINE') return true
  const list = Array.isArray(slots) ? (slots as { mode?: string }[]) : []
  return list.length > 0 && list.every((s) => s.mode === 'ONLINE')
}

/** The percent / fixed parts for the group (online amounts when the group is online). */
export function groupParts(rule: RuleWithOnline, online: boolean): { percent: number | null; fixed: number | null } {
  if (!online) return { percent: rule.percent, fixed: rule.fixed }
  return { percent: set(rule.onlinePercent) ? rule.onlinePercent! : rule.percent, fixed: set(rule.onlineFixed) ? rule.onlineFixed! : rule.fixed }
}

/** The way one session day was taught: the one-off change of that day, else the slot of that weekday, else BRANCH. */
export function modeOfDay(date: string, slots: unknown, overrides: Map<string, string>): Mode {
  const o = overrides.get(date)
  if (o) return o as Mode
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay()
  const slot = (Array.isArray(slots) ? (slots as { dayOfWeek: number; mode?: Mode }[]) : []).find((s) => s.dayOfWeek === wd)
  return slot?.mode ?? 'BRANCH'
}

/** Prisma row → online parts (Decimal | null). */
export function onlineFrom(fixed: unknown, percent: unknown, perSession: unknown, oneToOne?: unknown): OnlineParts {
  const n = (v: unknown) => (v != null ? Number(v) : null)
  return { onlineFixed: n(fixed), onlinePercent: n(percent), onlinePerSession: n(perSession), oneToOnePerSession: n(oneToOne) }
}
