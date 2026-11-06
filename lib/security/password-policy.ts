/**
 * Security batch (2026-11-06): password rules. Staff accounts reach money and every family's data, so they need a longer password
 * than a parent or a student. Pure (tests/security.test.ts).
 */

export const PORTAL_ROLES = ['PARENT', 'GUARDIAN', 'STUDENT']
export const STAFF_MIN = 10
export const PORTAL_MIN = 8

/** A message when the password is too weak for this role, else null. */
export function passwordProblem(role: string | null | undefined, password: string): { en: string; ar: string } | null {
  const staff = !PORTAL_ROLES.includes(String(role ?? '').toUpperCase())
  const min = staff ? STAFF_MIN : PORTAL_MIN
  if (password.length < min) return { en: `The password must be at least ${min} characters`, ar: `الباسورد لازم ${min} حروف على الأقل` }
  if (staff && !(/[a-zA-Z؀-ۿ]/.test(password) && /\d/.test(password))) return { en: 'A staff password needs letters and numbers', ar: 'باسورد الموظف لازم فيه حروف وأرقام' }
  if (/^(.)\1+$/.test(password)) return { en: 'The password is too easy', ar: 'الباسورد سهل أوي' }
  return null
}

/** A spreadsheet cell that starts like a formula is written as text, so a typed "=HYPERLINK(...)" never runs. */
export function safeCell(v: unknown): string {
  const s = String(v ?? '')
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}
