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

/** `onlyGroups` (instructors, 2026-10-24 owner): the person sees ONLY these groups and their students, whatever the places —
 *  campusIds then only matter for place lists (holidays, branch names). */
export interface Places { all: boolean; campusIds: string[]; groupIds: string[]; primary: string | null; onlyGroups?: string[] }

export const PORTAL_ROLES = ['STUDENT', 'PARENT', 'GUARDIAN']
export const NO_PLACES: Places = { all: false, campusIds: [], groupIds: [], primary: null }
export const ALL_PLACES: Places = { all: true, campusIds: [], groupIds: [], primary: null }

export function resolvePlaces(i: { role: string; allLocations: boolean; primary: string | null; extra: string[]; groups: string[]; teacherGroups?: string[]; allCampuses?: string[] }): Places {
  if (i.role === 'SUPER_ADMIN') return { ...ALL_PLACES, primary: i.primary }
  if (PORTAL_ROLES.includes(i.role)) return NO_PLACES
  // Instructors see only the groups they teach / cover (+ single groups given to them) and those groups' students.
  // "Works in every place" only means he can be put in groups anywhere — it never opens every student.
  if (i.role === 'TEACHER' && i.teacherGroups) {
    const campusIds = i.allLocations ? [...(i.allCampuses ?? [])] : [...new Set([i.primary, ...i.extra].filter((x): x is string => !!x))]
    return { all: false, campusIds, groupIds: [], primary: i.primary, onlyGroups: [...new Set([...i.teacherGroups, ...i.groups])] }
  }
  if (i.allLocations) return { ...ALL_PLACES, primary: i.primary }
  const campusIds = [...new Set([i.primary, ...i.extra].filter((x): x is string => !!x))]
  if (!campusIds.length && !i.groups.length) return { ...ALL_PLACES, primary: null }
  return { all: false, campusIds, groupIds: [...new Set(i.groups)], primary: i.primary }
}

/** The header filter: one place (must be allowed) or everything allowed. Never widens. */
export function narrow(p: Places, selected: string | null | undefined): Places {
  if (!selected || selected === 'ALL') return p
  if (p.all || p.campusIds.includes(selected)) return { all: false, campusIds: [selected], groupIds: [], primary: p.primary, ...(p.onlyGroups && { onlyGroups: p.onlyGroups }) }
  return p
}

export const allowsCampus = (p: Places, campusId: string | null | undefined) => p.all || (!!campusId && p.campusIds.includes(campusId))
export const allowsGroup = (p: Places, g: { id: string; campusId: string }) =>
  p.onlyGroups ? p.onlyGroups.includes(g.id) : p.all || p.campusIds.includes(g.campusId) || p.groupIds.includes(g.id)

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
  if (p.onlyGroups) return { AND: [{ id: { in: p.onlyGroups.length ? p.onlyGroups : ['__none__'] } }] }
  if (p.all) return {}
  const or: Record<string, unknown>[] = []
  if (p.campusIds.length) or.push({ campusId: { in: p.campusIds } })
  if (p.groupIds.length) or.push({ id: { in: p.groupIds } })
  return or.length ? { AND: [{ OR: or }] } : { id: '__none__' }
}

/** Instructors keep the students who are in their groups now or finished there (results) — not those who left / moved. */
export const TEACHER_STUDENT_STATUSES = ['ACTIVE', 'PROMOTED', 'RETAINED', 'GRADUATED'] as const

/** Students: of a visible place, or enrolled in one of the person's single groups. */
export function studentWhere(p: Places): Record<string, unknown> {
  if (p.onlyGroups) return { AND: [{ enrollments: { some: { classSectionId: { in: p.onlyGroups.length ? p.onlyGroups : ['__none__'] }, status: { in: [...TEACHER_STUDENT_STATUSES] } } } }] }
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

/**
 * Invoices (and everything hanging on an invoice: payments, refunds, online payments): the invoice's group place, or —
 * for an invoice without a group — the student's place.
 */
export function invoiceWhere(p: Places): Record<string, unknown> {
  if (p.all) return {}
  return { AND: [{ OR: [{ classSection: groupWhere(p) }, { AND: [{ classSectionId: null }, { student: studentWhere(p) }] }] }] }
}

/**
 * Reports made for ONE place (P&L statement, expense ledger): the requested place if allowed; with every place the
 * request as is (null = whole company); otherwise the primary place (or the first one).
 */
export function onePlace(p: Places, requested: string | null | undefined): string | null {
  if (p.all) return requested ?? null
  if (requested && p.campusIds.includes(requested)) return requested
  return p.primary && p.campusIds.includes(p.primary) ? p.primary : p.campusIds[0] ?? '__none__'
}

/**
 * Instructors a person sees: primary place or an extra place among the person's places, instructors for every place,
 * and the instructors of the person's single groups.
 */
export function teacherWhere(p: Places): Record<string, unknown> {
  if (p.all) return {}
  const or: Record<string, unknown>[] = [{ user: { allLocations: true } }]
  if (p.campusIds.length) {
    or.push({ campusId: { in: p.campusIds } }, { user: { placeAccess: { some: { campusId: { in: p.campusIds } } } } })
  }
  if (p.groupIds.length) or.push({ subjectOfferings: { some: { classSectionId: { in: p.groupIds } } } })
  return { AND: [{ OR: or }] }
}

/** Office staff (Admin / Accountant rows): their place or an extra place among the person's places. */
export function staffWhere(p: Places): Record<string, unknown> {
  if (p.all) return {}
  const ids = p.campusIds.length ? p.campusIds : ['__none__']
  return { AND: [{ OR: [{ campusId: { in: ids } }, { user: { allLocations: true } }, { user: { placeAccess: { some: { campusId: { in: ids } } } } }] }] }
}

/**
 * Accounts a person sees (Credential management): staff, instructors and students of their places, the parents of
 * those students, and their own account.
 */
export function userWhere(p: Places, selfId: string): Record<string, unknown> {
  if (p.all) return {}
  const staff = staffWhere(p)
  const students = studentWhere(p)
  return {
    AND: [{
      OR: [
        { id: selfId },
        { admin: staff }, { branchManager: staff }, { secretary: staff }, { marketingStaff: staff }, { accountant: staff },
        { teacher: teacherWhere(p) },
        { student: students },
        { parent: { students: { some: students } } },
        { guardian: { students: { some: students } } },
      ],
    }],
  }
}
