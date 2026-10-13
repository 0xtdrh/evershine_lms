/**
 * M0 places & access (docs/design-locations-and-partners.md §11, owner 2026-10-13). Pure — no database, tested in
 * tests/places-rules.test.ts.
 *
 * A "place" is a Campus: a TechNova branch (kind MAIN) or a partner's place (kind PARTNER, M1). A staff member sees:
 * - SUPER_ADMIN or `allLocations` → every place;
 * - otherwise their primary place (the campus in their role profile) + extra places (UserPlaceAccess)
 *   + single groups (UserGroupAccess, e.g. covering the Thursday groups somewhere else);
 * - a staff member with no primary place and nothing extra → every place (nobody is locked out by surprise).
 * The header filter (cookie `tn_place`) can narrow it to one place; it can never widen it.
 */

export interface Places { all: boolean; campusIds: string[]; groupIds: string[]; primary: string | null }

export const PORTAL_ROLES = ['STUDENT', 'PARENT', 'GUARDIAN']
export const NO_PLACES: Places = { all: false, campusIds: [], groupIds: [], primary: null }
export const ALL_PLACES: Places = { all: true, campusIds: [], groupIds: [], primary: null }

export function resolvePlaces(i: { role: string; allLocations: boolean; primary: string | null; extra: string[]; groups: string[] }): Places {
  if (i.role === 'SUPER_ADMIN') return { ...ALL_PLACES, primary: i.primary }
  if (PORTAL_ROLES.includes(i.role)) return NO_PLACES
  if (i.allLocations) return { ...ALL_PLACES, primary: i.primary }
  const campusIds = [...new Set([i.primary, ...i.extra].filter((x): x is string => !!x))]
  if (!campusIds.length && !i.groups.length) return { ...ALL_PLACES, primary: null }
  return { all: false, campusIds, groupIds: [...new Set(i.groups)], primary: i.primary }
}

/** The header filter: one place (must be allowed) or everything allowed. Never widens. */
export function narrow(p: Places, selected: string | null | undefined): Places {
  if (!selected || selected === 'ALL') return p
  if (p.all || p.campusIds.includes(selected)) return { all: false, campusIds: [selected], groupIds: [], primary: p.primary }
  return p
}

export const allowsCampus = (p: Places, campusId: string | null | undefined) => p.all || (!!campusId && p.campusIds.includes(campusId))
export const allowsGroup = (p: Places, g: { id: string; campusId: string }) => p.all || p.campusIds.includes(g.campusId) || p.groupIds.includes(g.id)

/** Prisma `where` for rows with a campus column (students, groups, invoices…). {} = no limit. */
export function campusWhere(p: Places, field = 'campusId'): Record<string, unknown> {
  if (p.all) return {}
  return { [field]: { in: p.campusIds.length ? p.campusIds : ['__none__'] } }
}

/**
 * Groups: their place, or one of the single groups given to the person. Wrapped in AND so spreading it into a where
 * that has its own OR (a search) never replaces one with the other.
 */
export function groupWhere(p: Places): Record<string, unknown> {
  if (p.all) return {}
  const or: Record<string, unknown>[] = []
  if (p.campusIds.length) or.push({ campusId: { in: p.campusIds } })
  if (p.groupIds.length) or.push({ id: { in: p.groupIds } })
  return or.length ? { AND: [{ OR: or }] } : { id: '__none__' }
}

/** Students: of a visible place, or enrolled in one of the person's single groups. */
export function studentWhere(p: Places): Record<string, unknown> {
  if (p.all) return {}
  const or: Record<string, unknown>[] = []
  if (p.campusIds.length) or.push({ campusId: { in: p.campusIds } })
  if (p.groupIds.length) or.push({ enrollments: { some: { classSectionId: { in: p.groupIds } } } })
  return or.length ? { AND: [{ OR: or }] } : { id: '__none__' }
}

/** Rows that belong to a group (attendance via enrollment, invoices via group…): `relation` is the path to the group. */
export function viaGroupWhere(p: Places, relation: string): Record<string, unknown> {
  return p.all ? {} : { [relation]: groupWhere(p) }
}

/** The one place to use when the old code needs a single value (create forms): the request, else the primary. */
export function placeForCreate(p: Places, requested: string | null | undefined): { ok: boolean; campusId: string | null } {
  if (requested) return allowsCampus(p, requested) ? { ok: true, campusId: requested } : { ok: false, campusId: null }
  if (p.primary && allowsCampus(p, p.primary)) return { ok: true, campusId: p.primary }
  if (!p.all && p.campusIds.length === 1) return { ok: true, campusId: p.campusIds[0] }
  return { ok: !p.all ? false : true, campusId: null }
}

/** Instructors for a group in a place: their places include it (primary / extra / all). */
export const teacherServes = (t: { all: boolean; campusIds: string[] }, campusId: string) => t.all || t.campusIds.includes(campusId)
