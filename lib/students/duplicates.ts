/**
 * Duplicate-student warning (2026-11-07, owner). Pure rules, tests in tests/student-duplicates.test.ts.
 * Before a new student is saved we look for one that may be the same child (also an old / withdrawn one: a returning
 * child should reuse the old record, so attendance, invoices and certificates stay together).
 *   SURE     = same name (first + last) and same parent phone, or same name and same birth date
 *   LIKELY   = same first name and same parent phone (last name typed another way)
 *   POSSIBLE = same full name only (common names happen: staff decide)
 * Brothers / sisters share the parent phone but have another first name: never a match.
 */

/** Arabic + English names compared the same way: no diacritics / tatweel, أ إ آ → ا, ة → ه, ى → ي, lower case, one space. */
export function normName(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ًͯ-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim()
}

/** Egyptian mobile in one form: 01xxxxxxxxx (from +20 / 0020 / missing 0 / Arabic digits). Other numbers: digits only. */
export function normPhone(s: string | null | undefined): string {
  let d = String(s ?? '').replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '')
  if (d.startsWith('0020')) d = d.slice(4)
  else if (d.startsWith('20') && d.length === 12) d = d.slice(2)
  if (d.length === 10 && d.startsWith('1')) d = `0${d}`
  return d
}

export type DuplicateLevel = 'SURE' | 'LIKELY' | 'POSSIBLE'

export interface NewStudent { firstName: string; lastName: string; dateOfBirth?: string | Date | null; phones: (string | null | undefined)[] }
export interface ExistingStudent { firstName: string; lastName: string; dateOfBirth: Date | string | null; phones: (string | null | undefined)[] }

const day = (d: string | Date | null | undefined) => {
  if (!d) return ''
  const x = new Date(d)
  return Number.isNaN(x.getTime()) ? '' : x.toISOString().slice(0, 10)
}

export function duplicateLevel(n: NewStudent, e: ExistingStudent): DuplicateLevel | null {
  const nf = normName(n.firstName), nl = normName(n.lastName), ef = normName(e.firstName), el = normName(e.lastName)
  if (!nf || !ef || nf !== ef) return null
  const sameLast = !!nl && nl === el
  const np = new Set(n.phones.map(normPhone).filter((p) => p.length >= 8))
  const samePhone = e.phones.map(normPhone).some((p) => p.length >= 8 && np.has(p))
  const sameBirth = !!day(n.dateOfBirth) && day(n.dateOfBirth) === day(e.dateOfBirth)
  if (sameLast && (samePhone || sameBirth)) return 'SURE'
  if (samePhone) return 'LIKELY'
  if (sameLast) return 'POSSIBLE'
  return null
}

export const LEVEL_ORDER: Record<DuplicateLevel, number> = { SURE: 0, LIKELY: 1, POSSIBLE: 2 }
