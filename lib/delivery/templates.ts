/**
 * a02 M1 batch 2 (2026-10-31) — ready mixes of ways ("templates") for a group's weekly sessions. Pure (tests in
 * tests/delivery-modes.test.ts). A template is an ordered list of ways, one per weekly session; it repeats when the
 * group meets more often than the list is long. The course has a default template, a level may change it.
 */

import { cleanModes, MODES, type Mode } from './modes'

export interface SlotLike { dayOfWeek: number; time: string; mode?: Mode }

/** A stored pattern → 1..7 ways (unknown entries dropped); null when nothing usable. */
export function cleanPattern(v: unknown): Mode[] | null {
  if (!Array.isArray(v)) return null
  const out = v.filter((x): x is Mode => (MODES as readonly string[]).includes(String(x))).slice(0, 7)
  return out.length ? out : null
}

/** Fills the ways of a group's weekly slots (in week order) from a template. */
export function applyTemplate<T extends SlotLike>(slots: T[], pattern: Mode[]): (T & { mode: Mode })[] {
  const sorted = [...slots].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.time.localeCompare(b.time))
  return sorted.map((s, i) => ({ ...s, mode: pattern[i % pattern.length] }))
}

/** The first slot whose way is not allowed for the level (null = all fine). */
export function firstNotAllowed<T extends SlotLike>(slots: T[], allowed: Mode[]): T | null {
  return slots.find((s) => !allowed.includes(s.mode ?? 'BRANCH')) ?? null
}

/** The template that applies: the level's own, else its course's. */
export const templateFor = (level: { deliveryTemplateId?: string | null }, course: { deliveryTemplateId?: string | null }) =>
  level.deliveryTemplateId ?? course.deliveryTemplateId ?? null

/** "1 online + 1 in a branch" style summary. */
export function patternText(pattern: Mode[], lang: 'en' | 'ar'): string {
  const counts = MODES.map((m) => [m, pattern.filter((x) => x === m).length] as const).filter(([, n]) => n > 0)
  const name = { BRANCH: ['in a branch', 'فرع'], ONLINE: ['online', 'أونلاين'], RECORDED: ['recorded', 'مسجلة'] } as const
  return counts.map(([m, n]) => `${n} ${name[m][lang === 'ar' ? 1 : 0]}`).join(lang === 'ar' ? ' + ' : ' + ')
}

export { cleanModes }
