/**
 * a02 teaching modes, M1 (2026-10-30) — pure rules, no Prisma (tests/delivery-modes.test.ts).
 * Design: docs/design-teaching-modes.md.
 *
 * A session is attended in one of three ways: BRANCH (in a room), ONLINE (live meeting), RECORDED (video, any time).
 * Allowed ways can be set on a track, a course, a level and a curriculum session; the most specific one that is set wins
 * (owner: "the closest wins"); nothing set anywhere = every way is allowed.
 * Where an item is offered: no OfferedIn rows = everywhere; otherwise only those places. A level is offered in a place
 * only when its course and its track are offered there too.
 */

export const MODES = ['BRANCH', 'ONLINE', 'RECORDED'] as const
export type Mode = (typeof MODES)[number]
export const MODE_LABEL: Record<Mode, { en: string; ar: string }> = {
  BRANCH: { en: 'In a branch', ar: 'في الفرع' },
  ONLINE: { en: 'Live online', ar: 'لايف أونلاين' },
  RECORDED: { en: 'Recorded', ar: 'مسجلة' },
}

export type Level = 'SESSION' | 'LEVEL' | 'COURSE' | 'TRACK'
export const CATALOG_KINDS = ['TRACK', 'COURSE', 'LEVEL'] as const
export type CatalogKind = (typeof CATALOG_KINDS)[number]

/** A stored value → a clean list (unknown entries dropped, no duplicates, MODES order); null / empty = not set. */
export function cleanModes(v: unknown): Mode[] | null {
  if (!Array.isArray(v)) return null
  const set = new Set(v.filter((x): x is Mode => (MODES as readonly string[]).includes(String(x))))
  const out = MODES.filter((m) => set.has(m))
  return out.length ? out : null
}

/** The allowed ways for a session of this chain, and which level of the catalog decided it. */
export function effectiveModes(chain: { session?: unknown; level?: unknown; course?: unknown; track?: unknown }): { modes: Mode[]; from: Level | 'DEFAULT' } {
  const order: [Level, unknown][] = [['SESSION', chain.session], ['LEVEL', chain.level], ['COURSE', chain.course], ['TRACK', chain.track]]
  for (const [from, v] of order) {
    const m = cleanModes(v)
    if (m) return { modes: m, from }
  }
  return { modes: [...MODES], from: 'DEFAULT' }
}

export const modeAllowed = (mode: Mode, allowed: Mode[]) => allowed.includes(mode)

/** Offered in this place? `rows` = the places each item is limited to (null / [] = everywhere). */
export function isOffered(places: { track?: string[] | null; course?: string[] | null; level?: string[] | null }, campusId: string | null | undefined): boolean {
  if (!campusId) return true
  return [places.track, places.course, places.level].every((list) => !list || list.length === 0 || list.includes(campusId))
}

/** Short Arabic / English text for a list of ways ("في الفرع أو لايف أونلاين"). */
export function modesText(modes: Mode[], lang: 'en' | 'ar'): string {
  if (modes.length === MODES.length) return lang === 'ar' ? 'كل الطرق' : 'Every way'
  return modes.map((m) => MODE_LABEL[m][lang]).join(lang === 'ar' ? ' أو ' : ' or ')
}
