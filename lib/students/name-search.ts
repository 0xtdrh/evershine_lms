/**
 * Prisma conditions for finding a student by a typed text (shared by the students list and the invoices list).
 * WHY no mode: 'insensitive' — MySQL utf8mb4_unicode_ci compares case-insensitively already (the option is PostgreSQL-only).
 */

// Final test X04 (22/11): "ادم" / "آدم", "فاطمه" / "فاطمة", "احمد" / "أحمد" must find the same student. The database
// collation does NOT treat these as equal, so the typed text is expanded into its spellings (capped) and each is searched.
const LETTER_FORMS = ['اأإآ', 'هة', 'يى']
const MAX_VARIANTS = 24

/** The typed text plus its other common Arabic spellings (alef forms, ه/ة, ي/ى). The typed text always comes first. */
export function arabicVariants(term: string): string[] {
  let out: string[] = ['']
  for (const ch of term) {
    const forms = LETTER_FORMS.find((f) => f.includes(ch))
    const opts = forms ? [ch, ...[...forms].filter((x) => x !== ch)] : [ch]
    const next: string[] = []
    for (const base of out) for (const o of opts) next.push(base + o)
    out = next.length > MAX_VARIANTS ? next.slice(0, MAX_VARIANTS) : next // a long word with many alefs: keep the first ones
  }
  return out
}

/** Name fields searched for a student (2026-10-24: the Arabic and English full names were missing). */
export function studentNameMatch(term: string) {
  const fields = ['firstName', 'lastName', 'fullNameAr', 'fullNameEn', 'fatherName'] as const
  return arabicVariants(term).flatMap((v) => fields.map((f) => ({ [f]: { contains: v } })))
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

/** One field matched against every spelling of the typed text — spread it inside an OR list (final test X04, other lists). */
export function containsVariants(field: string, term: string): Record<string, { contains: string }>[] {
  return arabicVariants(term.trim()).map((v) => ({ [field]: { contains: v } }))
}
