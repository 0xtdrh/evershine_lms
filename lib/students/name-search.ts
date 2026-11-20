/**
 * Prisma conditions for finding a student by a typed text (shared by the students list and the invoices list).
 * WHY no mode: 'insensitive' — MySQL utf8mb4_unicode_ci compares case-insensitively already (the option is PostgreSQL-only).
 */

/** Name fields searched for a student (2026-10-24: the Arabic and English full names were missing). */
export function studentNameMatch(term: string) {
  return [
    { firstName: { contains: term } },
    { lastName: { contains: term } },
    { fullNameAr: { contains: term } },
    { fullNameEn: { contains: term } },
    { fatherName: { contains: term } },
  ]
}

/** Every way a typed text can match a student: a name, the registration number, or "first last" (each word one name). */
export function studentSearchOr(search: string) {
  const s = search.trim()
  return [
    ...studentNameMatch(s),
    { registrationNumber: { contains: s } },
    ...(s.includes(' ') ? [{ AND: s.split(/\s+/).map((w) => ({ OR: studentNameMatch(w) })) }] : []),
  ]
}
